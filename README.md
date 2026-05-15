# openwrt-lab

计算机网络课程实验 - 基于OpenWrt的流量监控与防火墙管理平台

## 项目结构

- `flow-monitor/` - 流量监控程序
- `firewall/` - 防火墙脚本 + Flask后端
- `web/` - HTML/JS前端页面

## 快速开始

详见 [部署文档](docs/deployment.md)

## API文档

详见 [API文档](docs/API.md)

## 目录结构说明（示例）

```
openwrt-lab/                            # 项目根目录
├── README.md                           # 项目说明
├── .gitignore                          # Git忽略规则（编译产物、临时文件）
│
├── docs/                               # 文档目录
│   ├── API.md                          # 接口文档
│   └── deployment.md                   # 部署文档
│
├── flow-monitor/                       # 流量监控模块（C语言+libpcap）
│   ├── Makefile                        # 编译配置（make即可编译）
│   ├── src/                            # 源代码目录
│   │   ├── main.c                      # 主程序入口、信号处理
│   │   ├── capture.c / .h              # 数据包捕获（pcap_open_live、pcap_loop）
│   │   ├── parser.c / .h               # 数据包解析（以太网/IP/TCP/UDP头）
│   │   ├── statistics.c / .h           # 流量统计（更新记录、线程安全）
│   │   └── output.c / .h               # 输出JSON（写入/tmp/flow_data.json）
│   └── scripts/                        # 辅助脚本
│       └── start_flow_monitor.sh       # 启动流量监控程序
│
├── firewall/                           # 防火墙模块（Shell + Sanic）
│   ├── scripts/                        # Shell脚本（调用iptables）
│   │   ├── add_rule.sh                 # 添加防火墙规则
│   │   ├── del_rule.sh                 # 删除指定规则（按行号）
│   │   ├── list_rules.sh               # 列出当前规则
│   │   └── flush_rules.sh              # 清空所有规则
│   └── backend/                        # Sanic后端
│       ├── app.py                      # 主程序（注册路由、启动服务）
│       ├── requirements.txt            # Python依赖
│       ├── firewall_api.py             # 防火墙接口（调用Shell脚本）
│       ├── traffic_api.py              # 流量接口（读取JSON文件）
│       └── utils.py                    # 工具函数（参数校验、日志）
│
├── web/                                # 前端模块（HTML/CSS/JS）
│   ├── index.html                      # 主页面（导航栏、两个Tab页）
│   ├── css/
│   │   └── style.css                   # 全局样式（表格、表单、卡片、响应式）
│   ├── js/
│   │   ├── main.js                     # 主入口（页面初始化、导航切换）
│   │   ├── api.js                      # API封装（统一后端调用）
│   │   ├── traffic.js                  # 流量页面（表格、ECharts图表）
│   │   └── firewall.js                 # 防火墙页面（表单提交、规则列表）
│   └── assets/
│       └── favicon.ico                 # 网站图标（可选）
│
├── scripts/                            # 项目级脚本
│   ├── deploy.sh                       # 一键部署到OpenWrt
│   ├── mock_data.sh                    # 生成Mock流量数据（联调用）
│   └── init_openwrt.sh                 # 初始化OpenWrt环境（安装依赖）
│
└── tests/                              # 测试脚本（可选）
    ├── test_api.sh                     # API接口测试（curl）
    └── test_firewall.sh                # 防火墙规则测试
```