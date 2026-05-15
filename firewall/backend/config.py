#!/usr/bin/env python3
# config.py - 配置文件

# 服务器配置
HOST = '0.0.0.0'
PORT = 5000

# 脚本路径（Ubuntu测试路径，部署时改为 /root/scripts）
SCRIPT_DIR = '/home/cheese/openwrt-lab/firewall/scripts'

# 流量数据文件路径（先做Mock）
TRAFFIC_DATA_FILE = '/tmp/flow_data.json'

# CORS配置
CORS_ORIGINS = ['http://localhost:8080', 'http://127.0.0.1:5500', '*']

# 日志级别
LOG_LEVEL = 'INFO'