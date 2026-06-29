#!/bin/sh
#
# firewall.sh - OpenWrt 防火墙规则管理脚本
#
# 用法:
#   ./firewall.sh add    <协议> <源IP> <目的IP> <端口> <动作>
#   ./firewall.sh delete <规则编号>
#   ./firewall.sh list
#   ./firewall.sh clear
#   ./firewall.sh status <源IP> <目的IP> <端口>

set -e

# 自动查找 iptables 路径
IPT=$(command -v iptables-legacy || command -v iptables || echo /usr/sbin/iptables-legacy)

ACTION="$1"

# ========== 参数校验函数 ==========

is_valid_ip() {
    ip="$1"
    [ "$ip" = "any" ] && return 0
    echo "$ip" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || return 1
    echo "$ip" | awk -F'.' '$1<=255 && $2<=255 && $3<=255 && $4<=255{exit 0}{exit 1}'
    return $?
}

is_valid_port() {
    port="$1"
    [ "$port" = "any" ] && return 0
    case "$port" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$port" -ge 1 ] && [ "$port" -le 65535 ]
    return $?
}

is_valid_protocol() {
    case "$1" in
        tcp|udp|icmp|any) return 0 ;;
        *) return 1 ;;
    esac
}

is_valid_action() {
    case "$1" in
        ACCEPT|DROP|REJECT) return 0 ;;
        *) return 1 ;;
    esac
}

# ========== 防火墙操作函数 ==========

do_add() {
    PROTO="$1"
    SRC_IP="$2"
    DST_IP="$3"
    PORT="$4"
    FW_ACTION="$5"

    if [ -z "$PROTO" ] || [ -z "$SRC_IP" ] || [ -z "$DST_IP" ] || [ -z "$PORT" ] || [ -z "$FW_ACTION" ]; then
        echo "{\"success\": false, \"error\": \"参数不完整，需要: 协议 源IP 目的IP 端口 动作\"}"
        return 1
    fi

    if ! is_valid_protocol "$PROTO"; then
        echo "{\"success\": false, \"error\": \"无效的协议: $PROTO (支持: tcp, udp, icmp, any)\"}"
        return 1
    fi

    if ! is_valid_ip "$SRC_IP"; then
        echo "{\"success\": false, \"error\": \"无效的源IP: $SRC_IP\"}"
        return 1
    fi

    if ! is_valid_ip "$DST_IP"; then
        echo "{\"success\": false, \"error\": \"无效的目的IP: $DST_IP\"}"
        return 1
    fi

    if ! is_valid_port "$PORT"; then
        echo "{\"success\": false, \"error\": \"无效的端口: $PORT (1-65535 或 any)\"}"
        return 1
    fi

    if ! is_valid_action "$FW_ACTION"; then
        echo "{\"success\": false, \"error\": \"无效的动作: $FW_ACTION (支持: ACCEPT, DROP, REJECT)\"}"
        return 1
    fi

    CMD="$IPT -I FORWARD 1"

    if [ "$PROTO" != "any" ]; then
        CMD="$CMD -p $PROTO"
    fi

    if [ "$SRC_IP" != "any" ]; then
        CMD="$CMD -s $SRC_IP"
    fi

    if [ "$DST_IP" != "any" ]; then
        CMD="$CMD -d $DST_IP"
    fi

    if [ "$PORT" != "any" ]; then
        CMD="$CMD -m $PROTO --dport $PORT"
    fi

    CMD="$CMD -j $FW_ACTION"

    if eval "$CMD" 2>/dev/null; then
        RULE_NUM=$($IPT -L FORWARD --line-numbers -n 2>/dev/null | grep "$SRC_IP" | grep "$DST_IP" | grep "$FW_ACTION" | awk '{print $1}' | head -1)
        echo "{\"success\": true, \"message\": \"规则添加成功\", \"rule_num\": \"$RULE_NUM\"}"
    else
        echo "{\"success\": false, \"error\": \"规则添加失败\"}"
        return 1
    fi
}

do_delete() {
    RULE_NUM="$1"

    if [ -z "$RULE_NUM" ]; then
        echo "{\"success\": false, \"error\": \"需要指定规则编号\"}"
        return 1
    fi

    case "$RULE_NUM" in
        ''|*[!0-9]*) echo "{\"success\": false, \"error\": \"规则编号必须是正整数\"}"; return 1 ;;
    esac

    if $IPT -D FORWARD "$RULE_NUM" 2>/dev/null; then
        echo "{\"success\": true, \"message\": \"规则 #$RULE_NUM 已删除\"}"
    else
        echo "{\"success\": false, \"error\": \"删除规则 #$RULE_NUM 失败\"}"
        return 1
    fi
}

do_list() {
    echo "{"
    echo "  \"success\": true,"
    echo "  \"chain\": \"FORWARD\","
    echo "  \"rules\": ["

    TEMP_FILE=$(mktemp)
    $IPT -L FORWARD --line-numbers -v -n 2>/dev/null > "$TEMP_FILE"
    
    FIRST=1
    while IFS= read -r line; do
        if echo "$line" | grep -qE '^[[:space:]]*[0-9]+'; then
            RULE_NUM=$(echo "$line" | awk '{print $1}')
            PKTS=$(echo "$line" | awk '{print $2}')
            BYTES=$(echo "$line" | awk '{print $3}')
            TARGET=$(echo "$line" | awk '{print $4}')
            PROT_NUM=$(echo "$line" | awk '{print $5}')
            SRC=$(echo "$line" | awk '{print $9}')
            DST=$(echo "$line" | awk '{print $10}')

            # 协议号转名称
            case "$PROT_NUM" in
                6)   PROT="tcp" ;;
                17)  PROT="udp" ;;
                1)   PROT="icmp" ;;
                0)   PROT="any" ;;
                *)   PROT="$PROT_NUM" ;;
            esac

            # 提取 dpt（目的端口）
            DPORT=$(echo "$line" | grep -oE 'dpt:[0-9]+' | cut -d: -f2)
            PORT_VAL="${DPORT:-any}"

            [ "$FIRST" = "0" ] && echo ","
            FIRST=0

            printf '    {"num": %s, "pkts": "%s", "bytes": "%s", "target": "%s", "prot": "%s", "src": "%s", "dst": "%s", "dport": "%s"}' \
                "$RULE_NUM" "$PKTS" "$BYTES" "$TARGET" "$PROT" "$SRC" "$DST" "$PORT_VAL"
        fi
    done < "$TEMP_FILE"
    
    rm -f "$TEMP_FILE"

    echo ""
    echo "  ]"
    echo "}"
}

do_clear() {
    $IPT -F FORWARD 2>/dev/null
    echo "{\"success\": true, \"message\": \"所有 FORWARD 链规则已清空\"}"
}

do_status() {
    SRC_IP="$1"
    DST_IP="$2"
    PORT="$3"

    if [ -z "$SRC_IP" ] || [ -z "$DST_IP" ] || [ -z "$PORT" ]; then
        echo "{\"success\": false, \"error\": \"参数不完整: 源IP 目的IP 端口\"}"
        return 1
    fi

    echo "{"
    echo "  \"success\": true,"
    echo "  \"test_info\": {"
    echo "    \"src_ip\": \"$SRC_IP\","
    echo "    \"dst_ip\": \"$DST_IP\","
    echo "    \"port\": \"$PORT\""
    echo "  }"
    echo "}"
}

# ========== 主入口 ==========

case "$ACTION" in
    add)
        do_add "$2" "$3" "$4" "$5" "$6"
        ;;
    delete)
        do_delete "$2"
        ;;
    list)
        do_list
        ;;
    clear)
        do_clear
        ;;
    status)
        do_status "$2" "$3" "$4"
        ;;
    *)
        echo "用法: $0 {add|delete|list|clear|status} [参数...]"
        echo ""
        echo "  add    <协议> <源IP> <目的IP> <端口> <动作>  - 添加规则"
        echo "  delete <规则编号>                            - 删除规则"
        echo "  list                                         - 列出规则"
        echo "  clear                                        - 清空规则"
        echo "  status <源IP> <目的IP> <端口>                 - 检查连通性状态"
        echo ""
        echo "示例:"
        echo "  $0 add tcp 192.168.1.100 192.168.1.200 80 ACCEPT"
        echo "  $0 add udp any any 53 DROP"
        echo "  $0 list"
        echo "  $0 delete 3"
        echo "  $0 clear"
        exit 1
        ;;
esac