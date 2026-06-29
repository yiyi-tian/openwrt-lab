/**
 * traffic.js - 流量监控页面逻辑（重构版）
 *
 * 图表：单张折线图，显示所有 IP 流的 current_rate_bps
 *   - 横轴：时间，30 秒滑动窗口，1 秒间隔刻度
 *   - 纵轴：速率（bps）
 *   - 右上角选择框：全部 / 单条流（src_ip → dst_ip）
 *
 * 清理策略（后端驱动）：
 *   - 每次 poll 记录每条流的 lastSeenInResponse 时间戳
 *   - 某条流超过 EXPIRE_MS（35s）未出现在响应中才从前端删除
 *   - 静默期（0 bps 但仍在后端）：曲线保留，透明度降低以示区分
 *
 * 表格筛选：源 IP / 目的 IP / 端口（源或目的）/ 协议，联合 AND 筛选，实时响应
 */

(function () {
    'use strict';

    /* ─── DOM refs ─── */
    const statActiveFlows  = document.getElementById('statActiveFlows');
    const statTotalBytes   = document.getElementById('statTotalBytes');
    const statPeakRate     = document.getElementById('statPeakRate');
    const statTotalPkts    = document.getElementById('statTotalPkts');
    const tableUpdateTime  = document.getElementById('tableUpdateTime');
    const trafficTableBody = document.getElementById('trafficTableBody');
    const trafficTableMore = document.getElementById('trafficTableMore');
    const flowSelect       = document.getElementById('flowSelect');

    // 筛选控件
    const filterSrcIp    = document.getElementById('filterSrcIp');
    const filterDstIp    = document.getElementById('filterDstIp');
    const filterPort     = document.getElementById('filterPort');
    const filterProtocol = document.getElementById('filterProtocol');
    const btnFilterClear = document.getElementById('btnFilterClear');
    const filterCount    = document.getElementById('filterCount');

    /* ─── 配置 ─── */
    const POLL_MS       = 1000;
    const WINDOW_SEC    = 30;
    const WINDOW_MS     = WINDOW_SEC * 1000;
    const EXPIRE_MS     = 35000;   // 后端 35s 未见到 → 前端删除
    const SILENT_MS     = 5000;    // 5s 无活动 → 曲线静默样式
    const TABLE_DEFAULT = 25;

    /* ─── 颜色池 ─── */
    const COLORS = [
        '#4da6ff','#4cd964','#ff6b6b','#ffcc00',
        '#af52de','#ff9500','#00c7be','#ff2d55',
        '#5ac8fa','#a2845e','#34aadc','#ff3b30',
        '#30d158','#64d2ff','#ffd60a','#bf5af2'
    ];
    const colorMap = {};
    let colorIdx = 0;
    function getColor(key) {
        if (!colorMap[key]) {
            colorMap[key] = COLORS[colorIdx % COLORS.length];
            colorIdx++;
        }
        return colorMap[key];
    }

    /* ─── 格式化 ─── */
    function formatBytes(b) {
        if (!b) return '0 B';
        const units = ['B','KB','MB','GB','TB'];
        let i = 0, v = b;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return v.toFixed(i ? 2 : 0) + ' ' + units[i];
    }
    function formatRate(bps) {
        if (!bps) return '0 bps';
        if (bps >= 1e9) return (bps / 1e9).toFixed(2) + ' Gbps';
        if (bps >= 1e6) return (bps / 1e6).toFixed(2) + ' Mbps';
        if (bps >= 1e3) return (bps / 1e3).toFixed(2) + ' Kbps';
        return bps.toFixed(0) + ' bps';
    }
    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = String(s ?? '');
        return d.innerHTML;
    }

    /* ─── 状态 ─── */
    let chart         = null;
    let tableExpanded = false;
    let lastFlows     = [];   // 最后一次从后端拿到的完整流列表，用于筛选时重渲染

    /**
     * flowHistory[key] = {
     *   points: [[timestamp_ms, rate_bps], ...],
     *   lastSeenInResponse: timestamp_ms,
     *   lastActiveTime: timestamp_ms,
     * }
     */
    const flowHistory = {};

    /* ─── 流 key ─── */
    function flowKey(f) { return f.src_ip + ' → ' + f.dst_ip; }

    /* ═══════════════════════════════════════
       筛选逻辑
    ═══════════════════════════════════════ */

    function getFilters() {
        return {
            srcIp:    (filterSrcIp    ? filterSrcIp.value.trim()    : ''),
            dstIp:    (filterDstIp    ? filterDstIp.value.trim()    : ''),
            port:     (filterPort     ? filterPort.value.trim()     : ''),
            protocol: (filterProtocol ? filterProtocol.value.trim() : ''),
        };
    }

    function hasAnyFilter(f) {
        return f.srcIp || f.dstIp || f.port || f.protocol;
    }

    /** 对单条流判断是否通过所有筛选条件（AND 联合） */
    function flowMatchesFilter(flow, f) {
        // 源 IP：子串匹配，支持前缀/网段模糊查找
        if (f.srcIp && flow.src_ip !== f.srcIp) return false;
        // 目的 IP
        if (f.dstIp && flow.dst_ip !== f.dstIp) return false;
        // 端口：匹配源端口或目的端口
        if (f.port) {
            const portVal = f.port;
            const srcMatch = String(flow.src_port || '') === portVal;
            const dstMatch = String(flow.dst_port || '') === portVal;
            if (!srcMatch && !dstMatch) return false;
        }
        // 协议：精确匹配（下拉框已限定选项）
        if (f.protocol && (flow.protocol || '').toUpperCase() !== f.protocol.toUpperCase()) return false;
        return true;
    }

    /** 更新筛选控件的视觉状态（高亮 + 清除按钮 + 计数） */
    function updateFilterUI(filters, total, matched) {
        const active = hasAnyFilter(filters);

        // 各输入框高亮
        [
            [filterSrcIp,    filters.srcIp],
            [filterDstIp,    filters.dstIp],
            [filterPort,     filters.port],
            [filterProtocol, filters.protocol],
        ].forEach(([el, val]) => {
            if (!el) return;
            el.classList.toggle('active', !!val);
        });

        // 清除按钮
        if (btnFilterClear) {
            btnFilterClear.style.display = active ? 'inline-flex' : 'none';
        }

        // 计数提示
        if (filterCount) {
            if (active) {
                filterCount.textContent = `${matched} / ${total} 条`;
                filterCount.classList.add('has-filter');
            } else {
                filterCount.textContent = '';
                filterCount.classList.remove('has-filter');
            }
        }
    }

    /** 清除所有筛选条件 */
    function clearFilters() {
        if (filterSrcIp)    filterSrcIp.value    = '';
        if (filterDstIp)    filterDstIp.value    = '';
        if (filterPort)     filterPort.value     = '';
        if (filterProtocol) filterProtocol.value = '';
        updateFilterUI(getFilters(), 0, 0);
        renderTable(lastFlows);
    }

    /* ═══════════════════════════════════════
       图表
    ═══════════════════════════════════════ */

    function initChart() {
        const dom = document.getElementById('flowChart');
        if (!dom) return;
        chart = echarts.init(dom);
        chart.setOption(buildBaseOption());
        window.addEventListener('resize', () => { chart && chart.resize(); });
    }

    function buildBaseOption() {
        return {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15,25,35,0.97)',
                borderColor: '#2a3f54',
                borderWidth: 1,
                textStyle: { color: '#e0e6ed', fontSize: 12 },
                formatter: function (params) {
                    if (!params.length) return '';
                    const t = new Date(params[0].value[0]).toTimeString().slice(0, 8);
                    let html = '<div style="margin-bottom:6px;color:#8899aa;font-size:11px;">' + t + '</div>';
                    params.forEach(p => {
                        html += '<div style="display:flex;justify-content:space-between;gap:20px;margin-bottom:2px;">'
                              + '<span style="display:flex;align-items:center;gap:6px;">'
                              + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'
                              + p.color + ';"></span>'
                              + '<span style="color:#c0ccda;font-size:12px;">' + escapeHtml(p.seriesName) + '</span></span>'
                              + '<b style="font-family:monospace;color:#e0e6ed;">' + formatRate(p.value[1]) + '</b></div>';
                    });
                    return html;
                }
            },
            legend: {
                data: [],
                textStyle: { color: '#8899aa', fontSize: 11 },
                top: 8,
                right: 160,
                type: 'scroll',
                pageTextStyle: { color: '#8899aa' }
            },
            grid: { left: 80, right: 20, top: 60, bottom: 36 },
            xAxis: {
                type: 'time',
                min: Date.now() - WINDOW_MS,
                max: Date.now(),
                minInterval: 1000,
                maxInterval: 5000,
                axisLine: { lineStyle: { color: '#2a3f54' } },
                axisTick: { lineStyle: { color: '#2a3f54' } },
                axisLabel: {
                    color: '#5a6a7a',
                    fontSize: 10,
                    formatter: v => new Date(v).toTimeString().slice(0, 8)
                },
                splitLine: { show: true, lineStyle: { color: '#1a2633', type: 'dashed' } }
            },
            yAxis: {
                type: 'value',
                min: 0,
                axisLabel: {
                    color: '#5a6a7a',
                    fontSize: 10,
                    formatter: v => v >= 1e9 ? (v/1e9).toFixed(0)+'G'
                                 : v >= 1e6 ? (v/1e6).toFixed(0)+'M'
                                 : v >= 1e3 ? (v/1e3).toFixed(0)+'K'
                                 : v
                },
                axisLine: { lineStyle: { color: '#2a3f54' } },
                splitLine: { lineStyle: { color: '#1a2633' } }
            },
            animation: true,
            animationDurationUpdate: 500,
            animationEasingUpdate: 'cubicOut',
            series: []
        };
    }

    /* ─── 更新历史（后端驱动的清理） ─── */
    function updateHistory(flows) {
        const now     = Date.now();
        const cutoff  = now - WINDOW_MS;
        const aligned = Math.floor(now / 1000) * 1000;

        flows.forEach(f => {
            const k    = flowKey(f);
            const rate = f.current_rate_bps || 0;

            if (!flowHistory[k]) {
                flowHistory[k] = {
                    points: [],
                    lastSeenInResponse: now,
                    lastActiveTime: rate > 0 ? now : 0
                };
            }
            flowHistory[k].lastSeenInResponse = now;
            if (rate > 0) flowHistory[k].lastActiveTime = now;

            const pts  = flowHistory[k].points;
            const last = pts[pts.length - 1];
            if (last && last[0] === aligned) {
                last[1] = rate;
            } else {
                pts.push([aligned, rate]);
            }
            flowHistory[k].points = pts.filter(pt => pt[0] >= cutoff);
        });

        // ── 清理：删除长时间无活动的流 ──
        Object.keys(flowHistory).forEach(k => {
            const state = flowHistory[k];
            const silentDuration = now - state.lastSeenInResponse;
            
            // 条件1：后端超过 35 秒未返回 → 删除
            if (silentDuration >= EXPIRE_MS) {
                delete flowHistory[k];
                delete colorMap[k];
                return;
            }
            
            // 条件2：连续 10 秒以上全为 0 → 清空历史数据点（但保留流结构）
            // 这样流量恢复时不会显示之前的 0 值
            const recentPoints = state.points.filter(pt => pt[0] >= now - 10000);
            const allZero = recentPoints.length >= 5 && recentPoints.every(pt => pt[1] === 0);
            if (allZero && state.lastActiveTime > 0 && (now - state.lastActiveTime) >= 10000) {
                // 清空所有历史点，只保留当前最后一个 0 点
                const lastPoint = state.points[state.points.length - 1];
                state.points = lastPoint ? [lastPoint] : [];
            }
        });
    }

    /* ─── 渲染图表 ─── */
    function renderChart() {
        if (!chart) return;
        const now      = Date.now();
        const selected = flowSelect ? flowSelect.value : 'all';
        const keys     = Object.keys(flowHistory);

        updateFlowSelect(keys);

        const series     = [];
        const legendData = [];

        keys.forEach(key => {
            if (selected !== 'all' && selected !== key) return;

            const state    = flowHistory[key];
            const data     = state.points.filter(pt => pt[0] >= now - WINDOW_MS);
            const color    = getColor(key);
            const isSilent = (now - state.lastActiveTime) >= SILENT_MS;
            const opacity  = isSilent ? 0.35 : 1.0;

            legendData.push(key);
            series.push({
                id: key,
                name: key,
                type: 'line',
                smooth: 0.5,
                showSymbol: data.length <= 8,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: { color, width: isSilent ? 1.5 : 2, opacity },
                itemStyle: { color, opacity },
                areaStyle: {
                    opacity: isSilent ? 0.04 : 0.12,
                    color: {
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: color + (isSilent ? '18' : '40') },
                            { offset: 1, color: color + '00' }
                        ]
                    }
                },
                data: data
            });
        });

        chart.setOption({
            xAxis:  { min: now - WINDOW_MS, max: now },
            legend: { data: legendData },
            series: series
        }, { replaceMerge: ['series'], lazyUpdate: false });
    }

    /* ─── 选择框 ─── */
    function updateFlowSelect(keys) {
        if (!flowSelect) return;
        const current = flowSelect.value || 'all';
        const valid   = (current === 'all' || keys.includes(current)) ? current : 'all';
        const sig     = keys.join('\n');
        if (flowSelect.dataset.sig === sig && flowSelect.value === valid) return;

        flowSelect.innerHTML = '<option value="all">全部</option>'
            + keys.map(k =>
                `<option value="${escapeHtml(k)}"${valid === k ? ' selected' : ''}>${escapeHtml(k)}</option>`
              ).join('');
        flowSelect.dataset.sig = sig;
        flowSelect.value = valid;
    }

    /* ─── 统计卡片 ─── */
    function updateStats(data) {
        const flows = data.flows || [];
        if (statActiveFlows) statActiveFlows.textContent = flows.filter(f => f.current_rate_bps > 0).length;
        let totalBytes = 0, totalPkts = 0, maxPeak = 0;
        flows.forEach(f => {
            totalBytes += f.total_bytes   || 0;
            totalPkts  += f.total_packets || 0;
            if ((f.peak_rate_bps || 0) > maxPeak) maxPeak = f.peak_rate_bps;
        });
        if (statTotalBytes) statTotalBytes.textContent = formatBytes(totalBytes);
        if (statPeakRate)   statPeakRate.textContent   = formatRate(maxPeak);
        if (statTotalPkts)  statTotalPkts.textContent  = totalPkts.toLocaleString();

        const dot  = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        if (dot)  dot.className   = 'status-dot connected';
        if (text) text.textContent = '已连接';
    }

    /* ─── 流量表格（含筛选） ─── */
    function renderTable(allFlows) {
        // 基础过滤：有流量或有历史字节
        const base = allFlows.filter(f => (f.current_rate_bps > 0) || (f.total_bytes > 0));
        base.sort((a, b) => (b.current_rate_bps || 0) - (a.current_rate_bps || 0));

        // 筛选
        const filters = getFilters();
        const filtered = hasAnyFilter(filters)
            ? base.filter(f => flowMatchesFilter(f, filters))
            : base;

        // 更新 UI 状态
        updateFilterUI(filters, base.length, filtered.length);

        if (!filtered.length) {
            const msg = hasAnyFilter(filters)
                ? '没有符合筛选条件的流量'
                : '等待流量数据...';
            trafficTableBody.innerHTML = `<tr><td colspan="11" class="empty-state">${msg}</td></tr>`;
            if (trafficTableMore) trafficTableMore.parentElement.style.display = 'none';
            return;
        }

        const visible   = tableExpanded ? filtered : filtered.slice(0, TABLE_DEFAULT);
        const remaining = filtered.length - TABLE_DEFAULT;

        trafficTableBody.innerHTML = visible.map(f => {
            const rate = f.current_rate_bps || 0;
            const rc   = rate >= 1e6 ? 'rate-high' : rate >= 1e5 ? 'rate-mid' : 'rate-low';
            return `<tr>
                <td><span class="ip-tag">${escapeHtml(f.src_ip)}</span></td>
                <td><span class="ip-tag">${escapeHtml(f.dst_ip)}</span></td>
                <td>${escapeHtml(f.protocol || '-')}</td>
                <td class="port-cell">${f.src_port || '-'} → ${f.dst_port || '-'}</td>
                <td class="${rc}">${formatRate(rate)}</td>
                <td>${formatRate(f.peak_rate_bps    || 0)}</td>
                <td>${formatRate(f.avg_rate_2s_bps   || 0)}</td>
                <td>${formatRate(f.avg_rate_10s_bps  || 0)}</td>
                <td>${formatRate(f.avg_rate_40s_bps  || 0)}</td>
                <td>${formatBytes(f.total_bytes      || 0)}</td>
                <td>${(f.total_packets || 0).toLocaleString()}</td>
            </tr>`;
        }).join('');

        const moreWrap = trafficTableMore ? trafficTableMore.parentElement : null;
        if (moreWrap) {
            if (!tableExpanded && filtered.length > TABLE_DEFAULT) {
                moreWrap.style.display     = 'flex';
                trafficTableMore.textContent = `显示更多（还有 ${remaining} 条）`;
            } else if (tableExpanded) {
                moreWrap.style.display     = 'flex';
                trafficTableMore.textContent = '收起';
            } else {
                moreWrap.style.display = 'none';
            }
        }
    }

    /* ─── 数据拉取 ─── */
    async function fetchData() {
        try {
            const resp = await fetch('/api/traffic/history');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            if (!data.success) throw new Error(data.error || 'unknown');

            lastFlows = data.flows || [];
            if (data.datetime && tableUpdateTime) {
                tableUpdateTime.textContent = '更新: ' + data.datetime;
            }

            updateStats(data);
            updateHistory(lastFlows);
            renderChart();
            renderTable(lastFlows);
        } catch (e) {
            console.warn('[Traffic]', e.message);
            const dot  = document.getElementById('statusDot');
            const text = document.getElementById('statusText');
            if (dot)  dot.className   = 'status-dot disconnected';
            if (text) text.textContent = '连接失败';
            renderChart();
        }
    }

    /* ─── 初始化 ─── */
    function init() {
        initChart();
        fetchData();
        setInterval(fetchData, POLL_MS);

        // 显示更多 / 收起
        if (trafficTableMore) {
            trafficTableMore.addEventListener('click', () => {
                tableExpanded = !tableExpanded;
                renderTable(lastFlows);
            });
        }

        // 图表曲线选择
        if (flowSelect) {
            flowSelect.addEventListener('change', renderChart);
        }

        // ── 筛选控件事件绑定 ──
        // 输入框：实时筛选（防抖 200ms）
        let filterTimer = null;
        function onFilterChange() {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => renderTable(lastFlows), 200);
        }
        [filterSrcIp, filterDstIp, filterPort].forEach(el => {
            if (el) el.addEventListener('input', onFilterChange);
        });
        // 下拉框：立即筛选
        if (filterProtocol) {
            filterProtocol.addEventListener('change', () => renderTable(lastFlows));
        }
        // 清除按钮
        if (btnFilterClear) {
            btnFilterClear.addEventListener('click', clearFilters);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) fetchData();
    });
})();