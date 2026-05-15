# 部署文档

## 一、项目概述

本项目包含三个模块：

| 模块 | 目录 | 技术栈 | 说明 |
|------|------|--------|------|
| 流量监控 | `flow-monitor/` | C语言 + libpcap | 抓包、解析、统计，输出JSON文件 |
| 防火墙后端 | `firewall/backend/` | Python3 + Sanic | RESTful API，调用iptables |
| Web前端 | `web/` | HTML/CSS/JS + ECharts | 流量图表、防火墙管理界面 |

---

## 二、开发环境（宿主机）

### 2.1 环境要求

- **操作系统**: Linux（Ubuntu 20.04+ / Debian 11+ 推荐）或 macOS
- **Python**: 3.8+
- **GCC**: 支持 C11 标准
- **libpcap-dev**: 数据包捕获开发库

### 2.2 安装开发依赖

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y build-essential libpcap-dev python3 python3-pip python3-venv
```

**macOS:**

```bash
# 需要先安装 Homebrew: https://brew.sh
brew install libpcap python3
```

### 2.3 克隆项目

```bash
git clone https://github.com/yiyi-tian/openwrt-lab.git openwrt-lab
cd openwrt-lab
```

### 2.4 编译流量监控模块

```bash
cd flow-monitor
make
./bin/flow_monitor -i lo    # 本地回环接口测试
```

> 开发时可用 `lo`（回环接口）或 `eth0` 测试。按 `Ctrl+C` 停止。

### 2.5 启动后端服务

```bash
cd firewall/backend

# 创建虚拟环境（推荐）
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动服务
python app.py
```

验证服务：

```bash
# 新开终端
curl http://localhost:8000/api/traffic/current
```

### 2.6 启动前端开发服务器

```bash
cd web

# 使用 Python 内置 HTTP 服务器（开发用）
python3 -m http.server 8080
```

浏览器访问 `http://localhost:8080` 即可看到页面。

> 开发时前端 `js/api.js` 中的 `API_BASE_URL` 应指向 `http://localhost:8000/api`。

### 2.7 开发工作流总结

```
终端1: flow-monitor/bin/flow_monitor -i lo     # 流量采集
终端2: cd firewall/backend && python app.py     # 后端API (端口8000)
终端3: cd web && python3 -m http.server 8080    # 前端 (端口8080)
浏览器: http://localhost:8080                   # 访问页面
```

---

## 三、交叉编译准备（宿主机 → OpenWrt）

由于 OpenWrt 设备 CPU 架构通常为 MIPS/ARM，需要在宿主机上交叉编译 `flow-monitor`。

### 3.1 下载 OpenWrt SDK

根据目标设备架构选择对应的 SDK：

```bash
# 示例：MT7621 (mipsel_24kc) 架构，OpenWrt 23.05
wget https://downloads.openwrt.org/releases/23.05.0/targets/ramips/mt7621/openwrt-sdk-23.05.0-ramips-mt7621_gcc-12.3.0_musl.Linux-x86_64.tar.xz
tar -xf openwrt-sdk-*.tar.xz
cd openwrt-sdk-*
```

> 常见架构对照：
> - MT7620/MT7621: `ramips/mt7621` (mipsel_24kc)
> - 树莓派4: `bcm27xx/bcm2711` (aarch64_cortex-a72)
> - x86_64 软路由: `x86/64`

### 3.2 创建 flow-monitor 包

```bash
# 在 SDK 目录下
mkdir -p package/flow-monitor/src
cp /path/to/openwrt-lab/flow-monitor/src/* package/flow-monitor/src/
cp /path/to/openwrt-lab/flow-monitor/Makefile package/flow-monitor/

# 编译
make package/flow-monitor/compile V=s
```

编译产物位于 `bin/packages/*/base/flow-monitor_*.ipk`。

### 3.3 编译 Python（可选）

如果 OpenWrt 设备上没有 Python3，需要交叉编译：

```bash
# 在 OpenWrt SDK 中
make menuconfig
# 选中 Languages -> Python -> python3
make package/python3/compile V=s
```

---

## 四、OpenWrt 设备部署

### 4.1 传输文件到设备

```bash
# 设置设备 IP
OWRT_IP=192.168.1.1

# 创建目录
ssh root@$OWRT_IP "mkdir -p /opt/openwrt-lab"

# 传输项目文件
scp -r firewall/backend root@$OWRT_IP:/opt/openwrt-lab/firewall/
scp -r web root@$OWRT_IP:/opt/openwrt-lab/
scp -r firewall/scripts root@$OWRT_IP:/opt/openwrt-lab/firewall/

# 传输编译好的 ipk 并安装
scp flow-monitor_*.ipk root@$OWRT_IP:/tmp/
ssh root@$OWRT_IP "opkg install /tmp/flow-monitor_*.ipk"
```

### 4.2 安装 OpenWrt 依赖

```bash
ssh root@$OWRT_IP

# 更新软件源
opkg update

# 安装运行时依赖
opkg install libpcap python3 python3-pip

# 安装 Python 依赖
cd /opt/openwrt-lab/firewall/backend
pip3 install -r requirements.txt
```

### 4.3 配置与测试

```bash
# 1. 确定监控网卡
ip link show
# 通常是 br-lan（LAN桥接）或 eth0

# 2. 测试流量监控
flow_monitor -i br-lan &
sleep 6
cat /tmp/flow_data.json   # 检查是否有数据输出

# 3. 测试后端API
cd /opt/openwrt-lab/firewall/backend
python3 app.py &
sleep 2
curl http://localhost:8000/api/traffic/current

# 4. 测试防火墙脚本
chmod +x /opt/openwrt-lab/firewall/scripts/*.sh
/opt/openwrt-lab/firewall/scripts/list_rules.sh
```

### 4.4 设置开机自启

```bash
# 流量监控服务
cat > /etc/init.d/flow-monitor << 'EOF'
#!/bin/sh /etc/rc.common

START=80
STOP=20
USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /usr/bin/flow_monitor -i br-lan
    procd_set_param respawn
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
EOF

chmod +x /etc/init.d/flow-monitor
/etc/init.d/flow-monitor enable

# 后端服务
cat > /etc/init.d/firewall-backend << 'EOF'
#!/bin/sh /etc/rc.common

START=85
STOP=25
USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /usr/bin/python3 /opt/openwrt-lab/firewall/backend/app.py
    procd_set_param respawn
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
EOF

chmod +x /etc/init.d/firewall-backend
/etc/init.d/firewall-backend enable
```

### 4.5 配置前端 Web 访问

**方式一：使用 uHTTPd（OpenWrt 自带）**

```bash
# 复制前端文件到 www 目录
cp -r /opt/openwrt-lab/web /www/openwrt-lab

# 配置 uHTTPd
cat >> /etc/config/uhttpd << 'EOF'

config uhttpd 'openwrtlab'
    list listen_http '0.0.0.0:8080'
    option home '/www/openwrt-lab'
    option index_page 'index.html'
EOF

/etc/init.d/uhttpd restart
```

**方式二：使用 Nginx（推荐，功能更强）**

```bash
opkg install nginx

cat > /etc/nginx/conf.d/openwrt-lab.conf << 'EOF'
server {
    listen 8080;
    root /opt/openwrt-lab/web;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

/etc/init.d/nginx restart
```

> 方式二的好处：前端和 API 同端口同域名，无需处理跨域问题。

### 4.6 启动全部服务

```bash
/etc/init.d/flow-monitor start
/etc/init.d/firewall-backend start
/etc/init.d/uhttpd restart   # 或 nginx restart
```

---

## 五、验证部署

### 5.1 检查服务状态

```bash
# 检查进程
ps | grep -E "flow_monitor|python3.*app.py"

# 检查端口监听
netstat -tlnp | grep -E "8000|8080"

# 检查流量数据
cat /tmp/flow_data.json | head -20
```

### 5.2 功能验证清单

| 验证项 | 操作 | 预期结果 |
|--------|------|----------|
| 流量API | `curl http://localhost:8000/api/traffic/current` | 返回JSON，含连接数据 |
| 防火墙API | `curl http://localhost:8000/api/firewall/rules` | 返回当前iptables规则 |
| 添加规则 | 通过API或Web页面添加一条DROP规则 | `iptables -L` 能看到新规则 |
| 删除规则 | 删除刚添加的规则 | 规则消失 |
| 前端页面 | 浏览器访问 `http://<设备IP>:8080` | 页面正常加载 |
| 流量图表 | 切换到"流量监控"Tab | ECharts图表有数据刷新 |
| 防火墙表单 | 切换到"防火墙"Tab，添加规则 | 规则列表更新 |

---

## 六、常见问题

### Q1: 宿主机编译 flow-monitor 报错 `pcap.h not found`

```bash
# Ubuntu/Debian
sudo apt install libpcap-dev

# macOS
brew install libpcap
```

### Q2: 交叉编译找不到工具链

确保下载的 SDK 版本与目标 OpenWrt 版本一致。检查方式：

```bash
ssh root@$OWRT_IP "cat /etc/openwrt_release"
```

### Q3: OpenWrt 设备空间不足

```bash
# 检查空间
df -h

# 清理软件包缓存
opkg clean

# 考虑使用 extroot 扩展存储
# 参考: https://openwrt.org/docs/guide-user/additional-software/extroot_configuration
```

### Q4: 后端启动报 Permission denied

防火墙脚本和 iptables 命令需要 root 权限：

```bash
# 确认当前用户
whoami
# 应以 root 运行
```

### Q5: 前端跨域报错

- 使用 Nginx 反向代理方案（推荐，见 4.5 方式二）
- 或检查后端 CORS 配置是否正确

### Q6: 流量数据为空

```bash
# 检查监控网卡是否正确
ip link show
# 修改 /etc/init.d/flow-monitor 中的 -i 参数

# 检查是否有流量经过该网卡
tcpdump -i br-lan -c 5
```

---

## 七、目录结构（设备上）

```
/opt/openwrt-lab/
├── flow-monitor/
│   └── bin/
│       └── flow_monitor          # 可执行文件
├── firewall/
│   ├── scripts/
│   │   ├── add_rule.sh
│   │   ├── del_rule.sh
│   │   ├── list_rules.sh
│   │   └── flush_rules.sh
│   └── backend/
│       ├── app.py
│       ├── firewall_api.py
│       ├── traffic_api.py
│       └── utils.py
└── web/
    ├── index.html
    ├── css/
    │   └── style.css
    ├── js/
    │   ├── main.js
    │   ├── api.js
    │   ├── traffic.js
    │   └── firewall.js
    └── assets/

/tmp/
└── flow_data.json                # 流量数据（运行时生成）
```