#!/bin/sh
#
# setup_openwrt.sh - OpenWrt 实验环境一键配置脚本
#
# 在 OpenWrt 虚拟机上执行此脚本，自动完成：
# 1. 更新软件源
# 2. 安装运行所需的依赖库
# 3. 验证可执行文件
# 4. 配置网络和防火墙
#
# 用法：
#   chmod +x setup_openwrt.sh
#   ./setup_openwrt.sh
#

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     OpenWrt 实验环境配置脚本                              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ========== Step 1: 更新软件源 ==========
echo "[Step 1/4] 更新软件源..."
opkg update
echo "[OK] 软件源更新完成"
echo ""

# ========== Step 2: 安装运行时依赖库 ==========
echo "[Step 2/4] 安装运行时依赖库..."
PACKAGES="libpcap libpthread"

for pkg in $PACKAGES; do
    if opkg list-installed | grep -q "^$pkg "; then
        echo "  [SKIP] $pkg 已安装"
    else
        echo "  [INSTALL] $pkg ..."
        opkg install $pkg
    fi
done

# 可选：安装 Samba 方便文件传输
if ! opkg list-installed | grep -q "^luci-app-samba4 "; then
    echo "  [INSTALL] luci-app-samba4 (可选，方便文件传输)..."
    opkg install luci-app-samba4 || echo "  [WARN] Samba 安装失败，可跳过"
fi

echo "[OK] 依赖库安装完成"
echo ""

# ========== Step 3: 验证可执行文件 ==========
echo "[Step 3/4] 验证流量监控程序..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "traffic_monitor" ]; then
    chmod +x traffic_monitor
    # 检查是否可执行
    if ./traffic_monitor --help >/dev/null 2>&1 || ./traffic_monitor -h >/dev/null 2>&1 || [ -x traffic_monitor ]; then
        echo "[OK] traffic_monitor 可执行文件就绪: $(pwd)/traffic_monitor"
    else
        echo "[WARN] traffic_monitor 存在但可能无法正常运行，请检查交叉编译工具链是否正确"
    fi
else
    echo "[ERROR] 未找到 traffic_monitor，请将交叉编译好的文件放入此目录"
    exit 1
fi
echo ""

# ========== Step 4: 设置防火墙脚本权限 ==========
echo "[Step 4/4] 配置防火墙脚本..."
if [ -f "firewall.sh" ]; then
    chmod +x firewall.sh
    echo "[OK] firewall.sh 权限已设置"
else
    echo "[WARN] 未找到 firewall.sh"
fi
echo ""

# ========== 验证网络配置 ==========
echo "[INFO] 验证网络配置..."

# 检查网络连通性
if ping -c 2 -W 2 114.114.114.114 >/dev/null 2>&1; then
    echo "[OK] 网络连通正常"
else
    echo "[WARN] 网络不通，请检查 /etc/config/network 配置"
    echo "      当前 LAN 配置:"
    grep -A10 "config interface 'lan'" /etc/config/network
fi

# 显示可用网卡
echo ""
echo "[INFO] 可用网络接口:"
ip link show | grep -E '^[0-9]+:' | awk '{print "  " $2}' | sed 's/:$//'

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     环境配置完成！                                       ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  启动流量监控:                                           ║"
echo "║    ./traffic_monitor br-lan /tmp/traffic_stats.json      ║"
echo "║                                                          ║"
echo "║  启动 Web 服务（在 webapp 目录）:                         ║"
echo "║    cd ../webapp && npm install && npm start              ║"
echo "║                                                          ║"
echo "║  或直接在宿主机访问 OpenWrt 文件后启动:                    ║"
echo "║    浏览器打开: http://<虚拟机IP>:3000                     ║"
echo "╚══════════════════════════════════════════════════════════╝"