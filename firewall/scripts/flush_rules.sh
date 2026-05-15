#!/bin/sh
# flush_rules.sh - 清空 FORWARD 链中所有防火墙规则
# 用法: ./flush_rules.sh

echo "警告: 此操作将清空 FORWARD 链中的所有防火墙规则"

# 显示当前规则数量
RULE_COUNT=$(iptables -L FORWARD -n --line-numbers 2>/dev/null | tail -n1 | awk '{print $1}')
if [ -z "$RULE_COUNT" ]; then
    RULE_COUNT=0
fi

echo "当前 FORWARD 链中有 $RULE_COUNT 条规则"

if [ "$RULE_COUNT" -eq 0 ]; then
    echo "没有规则需要清空"
    exit 0
fi

# 确认操作
echo -n "确认清空所有规则? [y/N]: "
read CONFIRM

case "$CONFIRM" in
    y|Y|yes|YES)
        echo "执行: iptables -F FORWARD"
        iptables -F FORWARD
        if [ $? -eq 0 ]; then
            echo "SUCCESS: 已清空 FORWARD 链中所有规则"
            exit 0
        else
            echo "ERROR: 清空规则失败"
            exit 1
        fi
        ;;
    *)
        echo "操作已取消"
        exit 0
        ;;
esac