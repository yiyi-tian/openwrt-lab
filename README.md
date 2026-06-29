# OpenWrt 网络管理系统

《计算机网络系统》实验二 —— 基于 OpenWrt 的网络应用程序开发

## 项目概述

本项目包含三个核心模块：

1. **C 语言流量监控程序** — 基于 libpcap 捕获网络数据包，统计分析流量信息
2. **防火墙管理 Shell 脚本** — 封装 iptables 命令，支持规则增删查改
3. **Node.js Web 管理系统** — Express 后端 + ECharts 可视化前端

## 项目结构

```
openwrt-experiment/
├── README.md
├── openwrt/                        # OpenWrt 虚拟机端程序
│   ├── traffic_monitor.c           # C 流量监控程序（libpcap）
│   ├── Makefile                    # 编译脚本
│   └── firewall.sh                 # 防火墙管理脚本
└── webapp/                         # Web 应用
    ├── package.json                # Node.js 依赖
    ├── server.js                   # Express 后端
    └── public/                     # 前端静态文件
        ├── index.html              # 主页面（导航标签）
        ├── css/
        │   └── style.css           # 样式表（暗色主题）
        └── js/
            ├── traffic.js          # 流量监控页面逻辑
            └── firewall.js         # 防火墙配置页面逻辑
```

---

## 一、环境准备：OpenWrt 虚拟机安装

### 1.1 下载 OpenWrt 镜像

从官网下载 x86_64 架构镜像：

```
https://downloads.openwrt.org/releases/24.10.0/targets/x86/64/
```

下载 `generic-ext4-combined-efi.img.gz`，解压得到 `.img` 文件。

### 1.2 转换镜像格式（img → vmdk）

使用 StarWind V2V Converter 或其他工具将 `.img` 转换为 `.vmdk` 格式。

> 下载地址：https://www.starwindsoftware.com/starwind-v2v-converter

### 1.3 创建 VMware 虚拟机

1. 打开 VMware Workstation，选择 **新建虚拟机 → 自定义（高级）**
2. 硬件兼容性选择默认即可
3. 选择 **稍后安装操作系统**
4. 客户机操作系统：**Linux → 其他 Linux 5.x 内核 64 位**
5. 虚拟机名称：`OpenWrt-Experiment`
6. 处理器：2 核，内存：**1024 MB**（≥512MB 即可）
7. 网络类型：**NAT**
8. I/O 控制器：默认
9. 虚拟磁盘类型：**SATA**
10. 选择 **使用现有虚拟磁盘** → 浏览选择转换好的 `.vmdk` 文件
11. 完成创建

### 1.4 配置虚拟机网络

启动 OpenWrt 虚拟机，在虚拟机控制台中操作：

```bash
# 编辑网络配置
vi /etc/config/network
```

修改 `lan` 接口配置（关键配置项）：

```
config interface 'lan'
    option device 'br-lan'
    option proto 'static'
    option ipaddr '192.168.127.100'      # 静态 IP（与 VMnet8 同网段）
    option netmask '255.255.255.0'
    option gateway '192.168.127.2'       # NAT 网关（VMnet8 网关地址）
    list dns '114.114.114.114'           # DNS 服务器
    list dns '8.8.8.8'
```

> **注意**：在宿主机命令行执行 `ipconfig`，查看 `VMware Network Adapter VMnet8` 的 IP 地址和子网掩码。OpenWrt 虚拟机的 IP 应与 VMnet8 在同一网段。

重启网络：

```bash
/etc/init.d/network restart
```

测试网络连通性：

```bash
ping -c 4 114.114.114.114
ping -c 4 baidu.com
```

### 1.5 安装必要软件包

```bash
# 更新软件源
opkg update

# 安装编译工具
opkg install gcc make

# 安装 libpcap 开发库
opkg install libpcap

# 安装 Node.js（可选 - 若磁盘空间不足，可在宿主机运行 Web 服务）
# opkg install node

# 安装 Samba（方便从宿主机传文件）
opkg install luci-app-samba4
```

> 如果 overlay 空间不足，可以使用交叉编译方式（见下文）。

---

## 二、编译与部署

### 方案 A：在 OpenWrt 虚拟机中编译（推荐）

```bash
# 1. 将 openwrt/ 目录下文件传入虚拟机（通过 Samba 或 scp）
#    在宿主机：\\<虚拟机IP>\mnt\p0

# 2. 在虚拟机中编译
cd /mnt/p0/openwrt
make

# 3. 运行流量监控程序
./traffic_monitor br-lan /tmp/traffic_stats.json
```

### 方案 B：交叉编译（磁盘空间不足时）

在宿主机上安装 OpenWrt SDK，交叉编译 C 程序后将二进制文件传入虚拟机。

### 方案 C：Web 服务部署方式选择

**方式 1 — Node.js 在 OpenWrt 上运行（完整方案）：**

```bash
# 在 OpenWrt 上安装 Node.js
opkg install node

# 将 webapp/ 传入虚拟机，安装依赖
cd /mnt/p0/webapp
npm install

# 启动 Web 服务
node server.js
# 访问: http://<虚拟机IP>:3000
```

**方式 2 — Node.js 在宿主机上运行（推荐）：**

```bash
# 在宿主机（Windows）上
cd webapp
npm install
node server.js

# 需要修改 server.js 中的路径配置：
# - trafficStatsFile: 指向 Samba 共享目录中的 JSON 文件
# - firewallScript: 指向宿主机上的 firewall.sh（需通过 SSH 远程执行）
```

---

## 三、使用说明

### 3.1 启动流量监控

```bash
# 在 OpenWrt 虚拟机上以 root 权限运行
./traffic_monitor [网卡名] [输出文件]

# 示例
./traffic_monitor br-lan /tmp/traffic_stats.json
```

程序启动后会：
- 显示可用的网络接口列表
- 每 1 秒在终端刷新流量统计表格
- 将 JSON 格式数据写入指定文件

### 3.2 启动 Web 管理界面

```bash
# 确保 traffic_monitor 正在运行
# 然后启动 Web 服务
cd webapp
npm install
npm start
```

浏览器访问 `http://localhost:3000`（或 `http://<虚拟机IP>:3000`）

### 3.3 流量监控页面

- **顶部统计卡片**：活跃流数、总流量、峰值速率、总数据包
- **折线图**：实时流量速率趋势（自动刷新）
- **详情表格**：每条流的源/目的 IP、协议端口、当前速率、峰值、平均值、累计流量

### 3.4 防火墙配置页面

- **添加规则**：填写协议类型、源/目的 IP、端口号、处理动作
- **快速预设**：一键填充常见规则（HTTP、SSH、DNS 等）
- **规则列表**：查看当前所有 FORWARD 链规则
- **删除/清空**：删除单条规则或清空所有规则
- **执行结果**：实时显示 Shell 脚本执行输出

### 3.5 防火墙规则验证

在添加规则后，可以通过以下方式验证规则是否生效：

```bash
# 在 OpenWrt 虚拟机上查看规则
iptables -L FORWARD --line-numbers -n -v

# 使用 hping3 或 nc 测试连通性（在另一台虚拟机上）
nc -zv <目标IP> <端口>
```

---

## 四、API 文档

### 服务状态

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 服务健康检查 |

### 流量监控

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/traffic` | 获取原始流量数据（完整 JSON） |
| GET | `/api/traffic/history` | 获取流量摘要（含各速率指标） |

**响应示例**：

```json
{
  "success": true,
  "timestamp": 1718500000,
  "datetime": "2026-06-16 12:00:00",
  "total_flows": 5,
  "flows": [
    {
      "src_ip": "192.168.1.100",
      "dst_ip": "192.168.1.200",
      "protocol": "TCP",
      "src_port": 54321,
      "dst_port": 80,
      "current_rate_bps": 125000.00,
      "peak_rate_bps": 500000,
      "avg_rate_2s_bps": 120000.00,
      "avg_rate_10s_bps": 110000.00,
      "avg_rate_40s_bps": 95000.00,
      "total_bytes": 1048576,
      "total_packets": 1024
    }
  ]
}
```

### 防火墙管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/firewall/list` | 列出所有规则 |
| POST | `/api/firewall/add` | 添加规则 |
| POST | `/api/firewall/delete` | 删除规则 |
| POST | `/api/firewall/clear` | 清空规则 |
| GET | `/api/firewall/status` | 检查连通性 |

**添加规则请求体**：

```json
{
  "protocol": "tcp",
  "src_ip": "192.168.1.100",
  "dst_ip": "192.168.1.200",
  "port": "80",
  "action": "ACCEPT"
}
```

---

## 五、常见问题

### Q1: 虚拟机无法连接网络

- 检查 VMnet8 网卡状态：`ipconfig` 查看 IPv4 地址
- 确认 OpenWrt 的 IP 与 VMnet8 在同一网段
- 确认网关配置为 VMnet8 的网关地址（通常是 `.2`）
- 检查 DNS 配置

### Q2: overlay 空间不足无法安装 gcc

- 使用方案 B 交叉编译
- 或扩展虚拟磁盘大小

### Q3: traffic_monitor 报错 "No such device"

- 使用 `ip link show` 查看可用网卡名称
- OpenWrt 上常用网卡名：`br-lan`、`eth0`、`eth1`
- 使用 `-h` 参数查看用法

### Q4: Node.js 启动后前端无法获取数据

- 确认 traffic_monitor 正在运行
- 检查 `/tmp/traffic_stats.json` 文件是否存在且有内容
- 检查 `firewall.sh` 路径是否正确且有执行权限（`chmod +x firewall.sh`）

---

## 六、成绩构成提醒

| 项目 | 占比 | 说明 |
|------|------|------|
| 实验报告 | 40% | **必须包含 AI 使用情况说明**（提示词、API 调用、对 AI 生成内容的评价） |
| 实验源码 | 30% | 完善注释 + README |
| 演示视频 | 20% | ≤5 分钟，展示完整运行过程 |
| 真实路由器部署 | 10%（加分项） | 烧录到家用路由器 |
