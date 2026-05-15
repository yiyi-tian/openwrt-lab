#!/usr/bin/env python3
# firewall_api.py - 防火墙接口（调用Shell脚本）

import asyncio
import os
from typing import Dict, Any, List, Optional

from config import SCRIPT_DIR
from utils import logger, create_response, ErrorCode


async def run_shell_script(script_name: str, args: List[str]) -> tuple:
    """
    异步执行 Shell 脚本
    script_name: 脚本文件名
    args: 脚本参数列表
    """
    script_path = os.path.join(SCRIPT_DIR, script_name)
    
    # 检查脚本是否存在
    if not os.path.exists(script_path):
        return '', f"Script not found: {script_path}", -1
    
    # 检查脚本是否可执行
    if not os.access(script_path, os.X_OK):
        return '', f"Script not executable: {script_path}", -1
    
    cmd = [script_path] + args
    logger.info(f"执行脚本: {' '.join(cmd)}")
    
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
    调用 add_rule.sh 脚本
    """
    # 构建脚本参数
    args = []
    
    # 链映射（脚本可能只支持 FORWARD，需要扩展）
    # 如果脚本不支持链参数，这里需要调整
    args.extend(['-c', chain.upper()])  # 添加链参数
    
    if protocol and protocol != 'all':
        args.extend(['-p', protocol.lower()])
    
    if in_iface:
        args.extend(['-i', in_iface])
    if out_iface:
        args.extend(['-o', out_iface])
    if src:
        args.extend(['-s', src])
    if dst:
        args.extend(['-d', dst])
    if sport:
        args.extend(['--sport', sport])
    if dport:
        args.extend(['--dport', dport])
    
    args.extend(['-j', target.upper()])
    
    if comment:
        args.extend(['-m', 'comment', '--comment', comment])
    
    stdout, stderr, code = await run_shell_script('add_rule.sh', args)
    
    if code == 0:
        # 获取新添加规则的序号（需要额外解析）
        rule_num = await get_rule_number(chain)
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
            f"Failed to add rule: {stderr}",
            detail=stderr
        )


async def get_rule_number(chain: str) -> Optional[int]:
    """获取最新添加的规则序号（通过列出规则获取第一条）"""
    rules = await list_rules(chain)
    if rules:
        return rules[0].get('num')
    return None


async def del_rule(chain: str, rule_num: int) -> Dict[str, Any]:
    """
    按序号删除防火墙规则
    调用 del_rule.sh 脚本
    """
    args = ['-c', chain.upper(), str(rule_num)]
    
    stdout, stderr, code = await run_shell_script('del_rule.sh', args)
    
    if code == 0:
        return create_response(ErrorCode.SUCCESS, "Rule deleted successfully")
    else:
        if 'not found' in stderr.lower() or 'bad rule' in stderr.lower():
            return create_response(
                ErrorCode.RULE_NOT_FOUND,
                f"Rule {rule_num} not found in chain {chain}",
                detail=stderr
            )
        return create_response(
            ErrorCode.SCRIPT_FAILED,
            f"Failed to delete rule: {stderr}",
            detail=stderr
        )


async def list_rules(chain: str = '') -> List[Dict[str, Any]]:
    """
    列出防火墙规则
    调用 list_rules.sh 脚本，然后解析输出
    """
    args = []
    if chain:
        args.extend(['-c', chain.upper()])
    
    stdout, stderr, code = await run_shell_script('list_rules.sh', args)
    
    if code != 0:
        logger.error(f"获取规则失败: {stderr}")
        return []
    
    # 解析脚本输出（需要根据 list_rules.sh 的输出格式调整）
    rules = parse_script_output(stdout, chain)
    return rules


def parse_script_output(output: str, chain: str) -> List[Dict[str, Any]]:
    """
    解析 list_rules.sh 的输出
    需要根据实际脚本输出格式调整
    """
    rules = []
    lines = output.strip().split('\n')
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith('Chain') or line.startswith('==='):
            continue
        
        # 示例输出格式: "1    DROP       tcp  --  0.0.0.0/0    8.8.8.8     tcp dpt:80"
        parts = line.split()
        if len(parts) >= 5 and parts[0].isdigit():
            rule = {
                'num': int(parts[0]),
                'chain': chain or 'unknown',
                'target': parts[1] if len(parts) > 1 else '',
                'protocol': parts[2] if len(parts) > 2 else '',
                'src': parts[3] if len(parts) > 3 and parts[3] != '0.0.0.0/0' else '',
                'dst': parts[4] if len(parts) > 4 and parts[4] != '0.0.0.0/0' else '',
                'sport': '',
                'dport': '',
                'in_iface': '',
                'out_iface': '',
                'bytes': 0,
                'packets': 0,
            }
            
            # 解析端口信息
            remaining = ' '.join(parts[5:]) if len(parts) > 5 else ''
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
    调用 flush_rules.sh 脚本
    """
    args = []
    if chain:
        args.extend(['-c', chain.upper()])
    
    stdout, stderr, code = await run_shell_script('flush_rules.sh', args)
    
    if code == 0:
        msg = f"Chain {chain} flushed successfully" if chain else "All chains flushed successfully"
        return create_response(ErrorCode.SUCCESS, msg)
    else:
        return create_response(
            ErrorCode.SCRIPT_FAILED,
            f"Failed to flush rules: {stderr}",
            detail=stderr
        )


async def get_default_policy(chain: str = '') -> Dict[str, Any]:
    """
    获取默认策略
    注意：如果使用脚本，需要单独实现
    """
    # 这里仍然直接调用 iptables，因为脚本通常不提供此功能
    chains = ['INPUT', 'OUTPUT', 'FORWARD'] if not chain else [chain.upper()]
    policies = {}
    
    for ch in chains:
        cmd = ['iptables', '-L', ch, '-n']
        stdout, _, code = await run_shell_command(cmd)  # 需要保留 run_shell_command
        
        if code == 0 and stdout:
            lines = stdout.strip().split('\n')
            if lines:
                import re
                match = re.search(r'policy (\w+)', lines[0])
                if match:
                    policies[ch] = match.group(1)
    
    return policies


# 保留直接执行命令的函数（用于 get_default_policy）
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


async def set_default_policy(chain: str, policy: str) -> Dict[str, Any]:
    """设置默认策略"""
    # 这里仍然直接调用 iptables
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