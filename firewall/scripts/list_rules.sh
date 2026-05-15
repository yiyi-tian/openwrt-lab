#!/bin/sh
# list_rules.sh - 列出 FORWARD 链中所有防火墙规则
# 用法: ./list_rules.sh

echo "================================================================"
echo "FORWARD 链防火墙规则列表"
echo "================================================================"
echo ""

# 使用 --line-numbers 显示行号，-n 不解析IP和端口，-v 显示详细信息
iptables -L FORWARD -n -v --line-numbers 2>/dev/null

if [ $? -ne 0 ]; then
    echo "错误: 无法获取防火墙规则"
    exit 1
fi

echo ""
echo "================================================================"
echo "规则说明:"
echo "  num   - 规则行号（用于删除规则）"
echo "  pkts  - 匹配该规则的数据包数量"
echo "  bytes - 匹配该规则的字节数"
echo "  target- 动作 (ACCEPT/DROP/REJECT)"
echo "  prot  - 协议 (tcp/udp/icmp)"
echo "  source- 源地址"
echo "  destination - 目的地址"
echo "================================================================"

exit 0