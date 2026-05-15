#!/usr/bin/env python3
# utils.py - 工具函数

import ipaddress
import re
import logging
from typing import Dict, Any, Tuple

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ==================== 错误码定义 ====================

class ErrorCode:
    SUCCESS = 0
    INVALID_PARAM = 1001
    RULE_NOT_FOUND = 1002
    SCRIPT_FAILED = 1003
    TRAFFIC_DATA_UNAVAILABLE = 1004
    INTERNAL_ERROR = 2001
    PERMISSION_DENIED = 2002


# ==================== 参数校验函数 ====================

def validate_chain(chain: str) -> bool:
    """校验规则链名称"""
    valid_chains = ['INPUT', 'OUTPUT', 'FORWARD']
    return chain.upper() in valid_chains if chain else False


def validate_target(target: str) -> bool:
    """校验动作"""
    valid_targets = ['ACCEPT', 'DROP', 'REJECT']
    return target.upper() in valid_targets if target else False


def validate_protocol(protocol: str) -> bool:
    """校验协议类型"""
    if not protocol or protocol == '':
        return True
    valid = ['tcp', 'udp', 'icmp', 'all']
    return protocol.lower() in valid


def validate_cidr(cidr: str) -> bool:
    """校验 CIDR 格式的 IP 地址"""
    if not cidr or cidr == '' or cidr == '0.0.0.0/0':
        return True
    try:
        ipaddress.ip_network(cidr, strict=False)
        return True
    except ValueError:
        return False


def validate_port_or_range(port: str) -> Tuple[bool, str]:
    """
    校验端口或端口范围
    返回: (是否有效, 错误信息)
    """
    if not port or port == '':
        return True, ""
    
    # 端口范围格式: 1024:2048
    if ':' in port:
        parts = port.split(':')
        if len(parts) != 2:
            return False, "端口范围格式应为 'start:end'"
        try:
            start = int(parts[0])
            end = int(parts[1])
            if 1 <= start <= 65535 and 1 <= end <= 65535 and start <= end:
                return True, ""
            return False, "端口范围应在 1-65535 之间且起始不大于结束"
        except ValueError:
            return False, "端口必须是数字"
    
    # 单端口
    try:
        p = int(port)
        if 1 <= p <= 65535:
            return True, ""
        return False, "端口范围应在 1-65535 之间"
    except ValueError:
        return False, "端口必须是数字"


def validate_iface(iface: str) -> bool:
    """校验网卡接口名称（简单校验）"""
    if not iface or iface == '':
        return True
    # 允许 eth0, eth1, br-lan, wlan0 等格式
    pattern = r'^[a-z][a-z0-9-]+[0-9]*$'
    return bool(re.match(pattern, iface))


def create_response(code: int, message: str = '', data=None, detail: str = '') -> Dict[str, Any]:
    """统一响应格式"""
    return {
        'code': code,
        'message': message,
        'data': data,
        'detail': detail
    }