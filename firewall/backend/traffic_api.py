#!/usr/bin/env python3
# traffic_api.py - 流量接口（先做Mock，等A同学完成后对接）

import json
import os
import asyncio
from typing import Dict, Any

from utils import logger, create_response
from config import TRAFFIC_DATA_FILE


async def get_traffic_data() -> Dict[str, Any]:
    """
    获取流量数据
    优先读取JSON文件，如果不存在则返回Mock数据
    """
    # 如果文件存在，读取真实数据
    if os.path.exists(TRAFFIC_DATA_FILE):
        try:
            with open(TRAFFIC_DATA_FILE, 'r') as f:
                data = json.load(f)
            return create_response(True, "", data)
        except Exception as e:
            logger.error(f"读取流量文件失败: {e}")
    
    # 返回Mock数据（用于前端开发）
    mock_data = {
        'timestamp': '2025-01-15T10:30:00',
        'total_bytes': 1024000,
        'total_packets': 1234,
        'flows': [
            {'src_ip': '192.168.29.128', 'dst_ip': '114.114.114.114',
             'src_port': 54321, 'dst_port': 53, 'protocol': 'udp',
             'bytes': 1024, 'packets': 2},
            {'src_ip': '192.168.29.2', 'dst_ip': '8.8.8.8',
             'src_port': 12345, 'dst_port': 80, 'protocol': 'tcp',
             'bytes': 51200, 'packets': 45},
        ]
    }
    return create_response(True, "使用Mock数据（等待流量监控程序）", mock_data)


async def reset_traffic_stats() -> Dict[str, Any]:
    """重置流量统计"""
    # TODO: 等flow-monitor实现后，调用重启流量监控程序
    return create_response(True, "重置功能待对接")