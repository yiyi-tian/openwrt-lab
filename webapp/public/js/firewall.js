/**
 * firewall.js - 防火墙配置页面逻辑（支持增删改）
 */

(function () {
    'use strict';

    // ========== DOM 引用 ==========
    const firewallForm  = document.getElementById('firewallForm');
    const fwProtocol    = document.getElementById('fwProtocol');
    const fwSrcIp       = document.getElementById('fwSrcIp');
    const fwDstIp       = document.getElementById('fwDstIp');
    const fwPort        = document.getElementById('fwPort');
    const fwAction      = document.getElementById('fwAction');
    const btnSubmit     = document.getElementById('btnAddRule');
    const btnCancelEdit = document.getElementById('btnCancelEdit');
    const btnClearRules = document.getElementById('btnClearRules');
    const btnRefresh    = document.getElementById('btnRefreshRules');
    const firewallTableBody = document.getElementById('firewallTableBody');
    const formTitle     = document.getElementById('formTitle');

    // 当前编辑的规则编号（null 表示新增模式）
    let editingRuleNum = null;

    // ========== 工具 ==========

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function toast(msg, type = 'info') {
        let el = document.getElementById('fw-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fw-toast';
            el.style.cssText = `
                position:fixed;top:72px;right:24px;z-index:9999;
                padding:12px 20px;border-radius:8px;font-size:13px;
                font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,0.4);
                transition:opacity 0.3s;max-width:360px;
            `;
            document.body.appendChild(el);
        }
        const colors = {
            success: ['#4cd964','rgba(76,217,100,0.15)','rgba(76,217,100,0.3)'],
            error:   ['#ff5e5b','rgba(255,94,91,0.15)','rgba(255,94,91,0.3)'],
            info:    ['#4da6ff','rgba(77,166,255,0.15)','rgba(77,166,255,0.3)'],
        };
        const [fg, bg, bd] = colors[type] || colors.info;
        el.style.color = fg;
        el.style.background = bg;
        el.style.border = `1px solid ${bd}`;
        el.style.opacity = '1';
        el.textContent = msg;
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
    }

    // ========== API ==========

    async function api(url, opts = {}) {
        try {
            const r = await fetch(url, {
                headers: { 'Content-Type': 'application/json' },
                ...opts
            });
            return await r.json();
        } catch (e) {
            return { success: false, error: '网络错误: ' + e.message };
        }
    }

    // ========== 规则列表 ==========

    async function refreshRules() {
        firewallTableBody.innerHTML = `<tr><td colspan="9" class="empty-state">加载中...</td></tr>`;
        const res = await api('/api/firewall/list');

        if (!res.success) {
            firewallTableBody.innerHTML = `<tr><td colspan="9" class="empty-state">加载失败: ${escapeHtml(res.error || '')}</td></tr>`;
            return;
        }

        const rules = res.rules || [];
        if (!rules.length) {
            firewallTableBody.innerHTML = `<tr><td colspan="9" class="empty-state">暂无防火墙规则</td></tr>`;
            return;
        }

        firewallTableBody.innerHTML = rules.map(r => `
            <tr id="rule-row-${r.num}">
                <td><span class="rule-num">#${escapeHtml(String(r.num))}</span></td>
                <td>${escapeHtml(String(r.pkts || '0'))}</td>
                <td>${escapeHtml(String(r.bytes || '0'))}</td>
                <td>
                    <span class="action-badge action-${(r.target||'').toLowerCase()}">
                        ${escapeHtml(r.target || '-')}
                    </span>
                </td>
                <td>${escapeHtml(r.prot || '-')}</td>
                <td><span class="ip-tag">${escapeHtml(r.src || '-')}</span></td>
                <td><span class="ip-tag">${escapeHtml(r.dst || '-')}</span></td>
                <td>
                    <div class="rule-actions">
                        <button class="btn-edit" onclick="editFirewallRule(${r.num},'${escapeHtml(r.prot)}','${escapeHtml(r.src)}','${escapeHtml(r.dst)}','${escapeHtml(r.target)}','${escapeHtml(r.dport||r.sport||'any')}')">
                            ✏️ 编辑
                        </button>
                        <button class="btn-delete" onclick="deleteFirewallRule(${r.num})">
                            🗑 删除
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // ========== 增删改 ==========

    async function addRule(data) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = '⏳ 提交中...';
        const res = await api('/api/firewall/add', { method: 'POST', body: JSON.stringify(data) });
        btnSubmit.disabled = false;
        resetForm();
        if (res.success) {
            toast('规则添加成功', 'success');
            refreshRules();
        } else {
            toast('添加失败: ' + (res.error || ''), 'error');
        }
    }

    async function editRule(ruleNum, data) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = '⏳ 保存中...';
        // 先删除原规则，再新增
        const delRes = await api('/api/firewall/delete', { method: 'POST', body: JSON.stringify({ rule_num: ruleNum }) });
        if (!delRes.success) {
            btnSubmit.disabled = false;
            toast('编辑失败（删除原规则出错）: ' + (delRes.error || ''), 'error');
            resetForm();
            return;
        }
        const addRes = await api('/api/firewall/add', { method: 'POST', body: JSON.stringify(data) });
        btnSubmit.disabled = false;
        resetForm();
        if (addRes.success) {
            toast('规则修改成功', 'success');
            refreshRules();
        } else {
            toast('修改失败（重新添加出错）: ' + (addRes.error || ''), 'error');
        }
    }

    async function deleteRule(ruleNum) {
        if (!confirm(`确认删除规则 #${ruleNum}？`)) return;
        const res = await api('/api/firewall/delete', { method: 'POST', body: JSON.stringify({ rule_num: ruleNum }) });
        if (res.success) {
            toast(`规则 #${ruleNum} 已删除`, 'success');
            refreshRules();
        } else {
            toast('删除失败: ' + (res.error || ''), 'error');
        }
    }

    async function clearRules() {
        if (!confirm('⚠️ 确认清空所有 FORWARD 链规则？此操作不可恢复！')) return;
        const res = await api('/api/firewall/clear', { method: 'POST' });
        if (res.success) {
            toast('所有规则已清空', 'success');
            refreshRules();
        } else {
            toast('清空失败: ' + (res.error || ''), 'error');
        }
    }

    // ========== 表单控制 ==========

    function resetForm() {
        editingRuleNum = null;
        firewallForm.reset();
        fwPort.value = 'any';
        btnSubmit.textContent = '➕ 添加规则';
        btnSubmit.className = 'btn btn-primary';
        if (btnCancelEdit) btnCancelEdit.style.display = 'none';
        if (formTitle) formTitle.textContent = '新增防火墙规则';
    }

    function enterEditMode(ruleNum, prot, src, dst, target, port) {
        editingRuleNum = ruleNum;
        if (formTitle) formTitle.textContent = `编辑规则 #${ruleNum}`;

        // 填充表单
        fwProtocol.value = prot.toLowerCase() === 'all' ? 'any' : prot.toLowerCase();
        fwSrcIp.value = src === '0.0.0.0/0' ? 'any' : src;
        fwDstIp.value = dst === '0.0.0.0/0' ? 'any' : dst;
        fwPort.value = port || 'any';
        fwAction.value = target;

        btnSubmit.textContent = '💾 保存修改';
        btnSubmit.className = 'btn btn-warning';
        if (btnCancelEdit) btnCancelEdit.style.display = 'inline-flex';

        // 滚动到表单
        firewallForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ========== 表单验证 ==========

    function validateIp(ip) {
        if (!ip || ip === 'any') return true;
        const parts = ip.split('.');
        if (parts.length !== 4) return false;
        return parts.every(p => { const n = parseInt(p); return !isNaN(n) && n >= 0 && n <= 255; });
    }

    function validatePort(port) {
        if (!port || port === 'any') return true;
        const n = parseInt(port);
        return !isNaN(n) && n >= 1 && n <= 65535;
    }

    // ========== 事件绑定 ==========

    firewallForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const data = {
            protocol: fwProtocol.value,
            src_ip:   fwSrcIp.value.trim() || 'any',
            dst_ip:   fwDstIp.value.trim() || 'any',
            port:     fwPort.value.trim() || 'any',
            action:   fwAction.value
        };

        if (!validateIp(data.src_ip)) { toast('源 IP 格式不正确', 'error'); return; }
        if (!validateIp(data.dst_ip)) { toast('目的 IP 格式不正确', 'error'); return; }
        if (!validatePort(data.port)) { toast('端口号格式不正确（1-65535 或 any）', 'error'); return; }

        if (editingRuleNum !== null) {
            await editRule(editingRuleNum, data);
        } else {
            await addRule(data);
        }
    });

    if (btnCancelEdit) btnCancelEdit.addEventListener('click', resetForm);
    if (btnClearRules) btnClearRules.addEventListener('click', clearRules);
    if (btnRefresh)    btnRefresh.addEventListener('click', refreshRules);

    // ========== 全局函数 ==========

    window.deleteFirewallRule = (num) => deleteRule(num);
    window.editFirewallRule = (num, prot, src, dst, target, port) => enterEditMode(num, prot, src, dst, target, port);
    // ========== 初始化 ==========

    function init() {
        resetForm();
        refreshRules();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();