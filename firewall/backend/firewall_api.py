#!/usr/bin/env python3
# firewall_api.py - 防火墙接口（异步调用Shell脚本）

import asyncio
from typing import Dict, Any, List, Optional

from config import SCRIPT_DIR
from utils import logger, create_response, ErrorCode


async def run_shell_command(cmd: List[str]) -> tuple:
    """异步执行Shell命令"""
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        return stdout.decode('utf-8'), stderr.decode('utf-8'), process.returncode
    except Exception as e:
        return '', str(e), -1


async def add_rule(chain: str, target: str, protocol: str = '',
                   src: str = '', dst: str = '', sport: str = '',
                   dport: str = '', in_iface: str = '', out_iface: str = '',
                   comment: str = '') -> Dict[str, Any]:
    """
    添加防火墙规则
    支持 INPUT/OUTPUT/FORWARD 链
    """
    # 构建 iptables 命令
    cmd = ['iptables', '-I', chain.upper()]
    
    if protocol and protocol != 'all':
        cmd.extend(['-p', protocol.lower()])
    
    if in_iface:
        cmd.extend(['-i', in_iface])
    if out_iface:
        cmd.extend(['-o', out_iface])
    if src and src != '0.0.0.0/0':
        cmd.extend(['-s', src])
    if dst and dst != '0.0.0.0/0':
        cmd.extend(['-d', dst])
    if sport:
        cmd.extend(['--sport', sport])
    if dport:
        cmd.extend(['--dport', dport])
    
    cmd.extend(['-j', target.upper()])
    
    if comment:
        cmd.extend(['-m', 'comment', '--comment', comment])
    
    logger.info(f"执行命令: {' '.join(cmd)}")
    stdout, stderr, code = await run_shell_command(cmd)
    
    if code == 0:
        # 获取新添加规则的序号
        rule_num = await get_rule_number(chain, cmd)
        return create_response(
            ErrorCode.SUCCESS,
            "Rule added successfully",
            {'rule_num': rule_num, 'chain': chain.upper()}
        )
    else:
        if 'Permission denied' in stderr:
            return create_response(
                ErrorCode.PERMISSION_DENIED,
                "Permission denied: need root privileges",
                detail=stderr
            )
        return create_response(
            ErrorCode.SCRIPT_FAILED,
            "Failed to add rule",
            detail=stderr
        )


async def get_rule_number(chain: str, cmd: List[str]) -> Optional[int]:
    """获取刚添加的规则序号"""
    # 简化实现：通过解析规则列表获取
    rules = await list_rules(chain)
    if rules:
        return rules[0].get('num')
    return None


async def del_rule(chain: str, rule_num: int) -> Dict[str, Any]:
    """
    按序号删除防火墙规则
    """
    cmd = ['iptables', '-D', chain.upper(), str(rule_num)]
    logger.info(f"执行命令: {' '.join(cmd)}")
    
    stdout, stderr, code = await run_shell_command(cmd)
    
    if code == 0:
        return create_response(ErrorCode.SUCCESS, "Rule deleted successfully")
    else:
        if 'Bad rule number' in stderr:
            return create_response(
                ErrorCode.RULE_NOT_FOUND,
                f"Rule {rule_num} not found in chain {chain}",
                detail=stderr
            )
        return create_response(
            ErrorCode.SCRIPT_FAILED,
            "Failed to delete rule",
            detail=stderr
        )


async def list_rules(chain: str = '') -> List[Dict[str, Any]]:
    """
    列出防火墙规则
    如果 chain 为空，返回所有链的规则
    """
    chains = ['INPUT', 'OUTPUT', 'FORWARD'] if not chain else [chain.upper()]
    all_rules = []
    
    for ch in chains:
        cmd = ['iptables', '-L', ch, '-n', '-v', '--line-numbers']
        stdout, stderr, code = await run_shell_command(cmd)
        
        if code != 0:
            logger.error(f"获取 {ch} 规则失败: {stderr}")
            continue
        
        rules = parse_iptables_output(stdout, ch)
        all_rules.extend(rules)
    
    return all_rules


def parse_iptables_output(output: str, chain: str) -> List[Dict[str, Any]]:
    """解析 iptables -L 输出"""
    rules = []
    lines = output.strip().split('\n')
    
    # 跳过前两行（Chain 和 header）
    for line in lines[2:]:
        line = line.strip()
        if not line or line.startswith('Chain'):
            continue
        
        parts = line.split()
        if len(parts) < 7:
            continue
        
        # 解析行号
        if not parts[0].isdigit():
            continue
        
        rule = {
            'num': int(parts[0]),
            'chain': chain,
            'target': parts[1],
            'protocol': parts[2],
            'src': parts[3] if parts[3] != '0.0.0.0/0' else '',
            'dst': parts[4] if parts[4] != '0.0.0.0/0' else '',
            'sport': '',
            'dport': '',
            'in_iface': '',
            'out_iface': '',
            'bytes': int(parts[5]) if parts[5].isdigit() else 0,
            'packets': int(parts[6]) if parts[6].isdigit() else 0,
        }
        
        # 解析额外信息（端口、网卡等）
        remaining = ' '.join(parts[7:]) if len(parts) > 7 else ''
        if 'dpt:' in remaining:
            import re
            match = re.search(r'dpt:(\d+)', remaining)
            if match:
                rule['dport'] = match.group(1)
        if 'spt:' in remaining:
            import re
            match = re.search(r'spt:(\d+)', remaining)
            if match:
                rule['sport'] = match.group(1)
        
        rules.append(rule)
    
    return rules


async def flush_rules(chain: str = '') -> Dict[str, Any]:
    """
    清空防火墙规则
    如果 chain 为空，清空所有链
    """
    chains = ['INPUT', 'OUTPUT', 'FORWARD'] if not chain else [chain.upper()]
    
    for ch in chains:
        cmd = ['iptables', '-F', ch]
        logger.info(f"执行命令: {' '.join(cmd)}")
        _, stderr, code = await run_shell_command(cmd)
        
        if code != 0:
            return create_response(
                ErrorCode.SCRIPT_FAILED,
                f"Failed to flush chain {ch}",
                detail=stderr
            )
    
    msg = f"Chain {chain} flushed successfully" if chain else "All chains flushed successfully"
    return create_response(ErrorCode.SUCCESS, msg)


async def get_default_policy(chain: str = '') -> Dict[str, Any]:
    """获取默认策略"""
    chains = ['INPUT', 'OUTPUT', 'FORWARD'] if not chain else [chain.upper()]
    policies = {}
    
    for ch in chains:
        cmd = ['iptables', '-L', ch, '-n']
        stdout, _, code = await run_shell_command(cmd)
        
        if code == 0 and stdout:
            lines = stdout.strip().split('\n')
            if lines:
                # Chain INPUT (policy ACCEPT)
                import re
                match = re.search(r'policy (\w+)', lines[0])
                if match:
                    policies[ch] = match.group(1)
    
    return policies


async def set_default_policy(chain: str, policy: str) -> Dict[str, Any]:
    """设置默认策略"""
    cmd = ['iptables', '-P', chain.upper(), policy.upper()]
    logger.info(f"执行命令: {' '.join(cmd)}")
    
    stdout, stderr, code = await run_shell_command(cmd)
    
    if code == 0:
        return create_response(
            ErrorCode.SUCCESS,
            f"Default policy for {chain} set to {policy}"
        )
    else:
        return create_response(
            ErrorCode.SCRIPT_FAILED,
            "Failed to set default policy",
            detail=stderr
        )