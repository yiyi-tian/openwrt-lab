#!/bin/sh
# add_rule.sh - 添加防火墙规则到 FORWARD 链
# 用法: ./add_rule.sh -p tcp -s 192.168.1.100 -d 8.8.8.8 --dport 80 -j DROP

usage() {
    echo "用法: $0 -p <协议> [-s <源IP>] [-d <目的IP>] [--sport <源端口>] [--dport <目的端口>] -j <动作>"
    echo "协议: tcp, udp, icmp, all"
    echo "动作: ACCEPT, DROP, REJECT"
    echo "示例: $0 -p tcp -d 8.8.8.8 --dport 80 -j DROP"
    exit 1
}

# ==================== 参数校验函数 ====================

validate_ip() {
    ip="$1"
    # 空IP表示任意地址，允许
    [ -z "$ip" ] && return 0
    # IPv4 格式校验
    echo "$ip" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    if [ $? -eq 0 ]; then
        # 检查每个数字是否在 0-255 范围
        for octet in $(echo "$ip" | tr '.' ' '); do
            [ "$octet" -gt 255 ] && return 1
        done
        return 0
    fi
    return 1
}

validate_port() {
    port="$1"
    [ -z "$port" ] && return 0
    echo "$port" | grep -qE '^[0-9]+$'
    [ $? -eq 0 ] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ]
}

validate_protocol() {
    protocol="$1"
    [ -z "$protocol" ] && return 1
    echo "$protocol" | grep -qE '^(tcp|udp|icmp|all)$'
}

validate_action() {
    action="$1"
    [ -z "$action" ] && return 1
    echo "$action" | grep -qE '^(ACCEPT|DROP|REJECT)$'
}

# ==================== 参数解析 ====================

PROTOCOL=""
SRC_IP=""
DST_IP=""
SPORT=""
DPORT=""
ACTION=""

while [ $# -gt 0 ]; do
    case "$1" in
        -p) PROTOCOL="$2"; shift 2 ;;
        -s) SRC_IP="$2"; shift 2 ;;
        -d) DST_IP="$2"; shift 2 ;;
        --sport) SPORT="$2"; shift 2 ;;
        --dport) DPORT="$2"; shift 2 ;;
        -j) ACTION="$2"; shift 2 ;;
        *) usage ;;
    esac
done

# ==================== 参数合法性校验 ====================

# 检查必填参数
if [ -z "$PROTOCOL" ] || [ -z "$ACTION" ]; then
    echo "错误: 协议(-p)和动作(-j)是必填参数"
    usage
fi

# 校验协议
if ! validate_protocol "$PROTOCOL"; then
    echo "错误: 无效的协议 '$PROTOCOL'，支持: tcp, udp, icmp, all"
    exit 1
fi

# 校验动作
if ! validate_action "$ACTION"; then
    echo "错误: 无效的动作 '$ACTION'，支持: ACCEPT, DROP, REJECT"
    exit 1
fi

# 校验源IP
if ! validate_ip "$SRC_IP"; then
    echo "错误: 无效的源IP地址 '$SRC_IP'"
    exit 1
fi

# 校验目的IP
if ! validate_ip "$DST_IP"; then
    echo "错误: 无效的目的IP地址 '$DST_IP'"
    exit 1
fi

# 端口只能在 TCP/UDP 协议下使用
if [ "$PROTOCOL" = "tcp" ] || [ "$PROTOCOL" = "udp" ]; then
    if ! validate_port "$SPORT"; then
        echo "错误: 无效的源端口 '$SPORT'，范围 1-65535"
        exit 1
    fi
    if ! validate_port "$DPORT"; then
        echo "错误: 无效的目的端口 '$DPORT'，范围 1-65535"
        exit 1
    fi
elif [ -n "$SPORT" ] || [ -n "$DPORT" ]; then
    echo "警告: 端口参数仅在协议为 tcp 或 udp 时有效，已忽略"
    SPORT=""
    DPORT=""
fi

# ==================== 构建 iptables 命令 ====================

CMD="iptables -I FORWARD"

[ -n "$PROTOCOL" ] && [ "$PROTOCOL" != "all" ] && CMD="$CMD -p $PROTOCOL"
[ -n "$SRC_IP" ] && CMD="$CMD -s $SRC_IP"
[ -n "$DST_IP" ] && CMD="$CMD -d $DST_IP"
[ -n "$SPORT" ] && CMD="$CMD --sport $SPORT"
[ -n "$DPORT" ] && CMD="$CMD --dport $DPORT"
[ -n "$ACTION" ] && CMD="$CMD -j $ACTION"

# ==================== 执行命令 ====================

echo "执行: $CMD"
eval $CMD

if [ $? -eq 0 ]; then
    echo "SUCCESS: 规则添加成功"
    exit 0
else
    echo "ERROR: 规则添加失败"
    exit 1
fi