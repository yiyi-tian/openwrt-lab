#!/bin/sh
# del_rule.sh - 按行号删除 FORWARD 链中的规则
# 用法: ./del_rule.sh <行号>

usage() {
    echo "用法: $0 <行号>"
    echo "示例: $0 3"
    echo "提示: 使用 list_rules.sh 查看行号"
    exit 1
}

# ==================== 参数检查 ====================

if [ $# -ne 1 ]; then
    echo "错误: 请提供规则行号"
    usage
fi

RULE_NUM="$1"

# 校验行号是否为数字且大于0
echo "$RULE_NUM" | grep -qE '^[0-9]+$'
if [ $? -ne 0 ] || [ "$RULE_NUM" -lt 1 ]; then
    echo "错误: 行号必须是大于0的整数"
    exit 1
fi

# ==================== 检查规则是否存在 ====================

# 获取 FORWARD 链的最大行号
MAX_LINE=$(iptables -L FORWARD -n --line-numbers 2>/dev/null | tail -n1 | awk '{print $1}')

# 如果 MAX_LINE 为空，说明没有规则
if [ -z "$MAX_LINE" ]; then
    echo "错误: FORWARD 链中没有任何规则"
    exit 1
fi

# 检查指定行号是否超出范围
if [ "$RULE_NUM" -gt "$MAX_LINE" ]; then
    echo "错误: 行号 $RULE_NUM 超出范围，当前共有 $MAX_LINE 条规则"
    exit 1
fi

# ==================== 执行删除 ====================

CMD="iptables -D FORWARD $RULE_NUM"
echo "执行: $CMD"
eval $CMD

if [ $? -eq 0 ]; then
    echo "SUCCESS: 规则 $RULE_NUM 已删除"
    exit 0
else
    echo "ERROR: 规则删除失败"
    exit 1
fi