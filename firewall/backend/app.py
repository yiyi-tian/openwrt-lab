#!/usr/bin/env python3
# app.py - Sanic主程序

from sanic import Sanic
from sanic.response import json
from sanic_cors import CORS

from config import HOST, PORT, CORS_ORIGINS
from firewall_api import add_rule, del_rule, list_rules, flush_rules, get_default_policy, set_default_policy
from traffic_api import get_traffic_data, reset_traffic_stats
from utils import (
    logger, create_response, ErrorCode,
    validate_chain, validate_target, validate_protocol,
    validate_cidr, validate_port_or_range, validate_iface
)

app = Sanic("OpenWrtBackend")
CORS(app, resources={r"/api/*": {"origins": CORS_ORIGINS}})


# ==================== 中间件 ====================

@app.middleware("request")
async def log_request(request):
    logger.info(f"{request.method} {request.path}")


# ==================== 流量API ====================

@app.route("/api/traffic", methods=["GET"])
async def api_traffic(request):
    result = await get_traffic_data()
    return json(result)


@app.route("/api/traffic/reset", methods=["POST"])
async def api_traffic_reset(request):
    result = await reset_traffic_stats()
    return json(result)


# ==================== 防火墙API ====================

@app.route("/api/firewall/rules", methods=["GET"])
async def api_firewall_list(request):
    """获取防火墙规则列表"""
    chain = request.args.get('chain', '')
    
    if chain and not validate_chain(chain):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid chain: must be INPUT, OUTPUT, or FORWARD"
        ), status=400)
    
    rules = await list_rules(chain)
    default_policy = await get_default_policy(chain)
    
    return json(create_response(
        ErrorCode.SUCCESS,
        "success",
        {
            'rules': rules,
            'default_policy': default_policy
        }
    ))


@app.route("/api/firewall/rules", methods=["POST"])
async def api_firewall_add(request):
    """添加防火墙规则"""
    data = request.json or {}
    
    # 参数校验
    chain = data.get('chain', '')
    if not validate_chain(chain):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid or missing 'chain': must be INPUT, OUTPUT, or FORWARD"
        ), status=400)
    
    target = data.get('target', '')
    if not validate_target(target):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid or missing 'target': must be ACCEPT, DROP, or REJECT"
        ), status=400)
    
    protocol = data.get('protocol', '')
    if not validate_protocol(protocol):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid 'protocol': must be tcp, udp, icmp, or all"
        ), status=400)
    
    src = data.get('src', '')
    if not validate_cidr(src):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            f"Invalid 'src' CIDR: {src}"
        ), status=400)
    
    dst = data.get('dst', '')
    if not validate_cidr(dst):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            f"Invalid 'dst' CIDR: {dst}"
        ), status=400)
    
    sport = data.get('sport', '')
    valid, err = validate_port_or_range(sport)
    if not valid:
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            f"Invalid 'sport': {err}"
        ), status=400)
    
    dport = data.get('dport', '')
    valid, err = validate_port_or_range(dport)
    if not valid:
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            f"Invalid 'dport': {err}"
        ), status=400)
    
    in_iface = data.get('in_iface', '')
    if not validate_iface(in_iface):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            f"Invalid 'in_iface': {in_iface}"
        ), status=400)
    
    out_iface = data.get('out_iface', '')
    if not validate_iface(out_iface):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            f"Invalid 'out_iface': {out_iface}"
        ), status=400)
    
    comment = data.get('comment', '')
    
    result = await add_rule(
        chain=chain, target=target, protocol=protocol,
        src=src, dst=dst, sport=sport, dport=dport,
        in_iface=in_iface, out_iface=out_iface, comment=comment
    )
    
    status = 200 if result['code'] == ErrorCode.SUCCESS else 400
    return json(result, status=status)


@app.route("/api/firewall/rules", methods=["DELETE"])
async def api_firewall_del(request):
    """删除防火墙规则"""
    data = request.json or {}
    
    chain = data.get('chain', '')
    if not validate_chain(chain):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid or missing 'chain': must be INPUT, OUTPUT, or FORWARD"
        ), status=400)
    
    rule_num = data.get('rule_num')
    if not rule_num or not str(rule_num).isdigit() or int(rule_num) <= 0:
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid or missing 'rule_num': must be a positive integer"
        ), status=400)
    
    result = await del_rule(chain, int(rule_num))
    status = 200 if result['code'] == ErrorCode.SUCCESS else 400
    return json(result, status=status)


@app.route("/api/firewall/flush", methods=["POST"])
async def api_firewall_flush(request):
    """清空防火墙规则"""
    data = request.json or {}
    chain = data.get('chain', '')
    
    if chain and not validate_chain(chain):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid 'chain': must be INPUT, OUTPUT, or FORWARD"
        ), status=400)
    
    result = await flush_rules(chain)
    status = 200 if result['code'] == ErrorCode.SUCCESS else 400
    return json(result, status=status)


@app.route("/api/firewall/policy", methods=["PUT"])
async def api_firewall_policy(request):
    """设置默认策略"""
    data = request.json or {}
    
    chain = data.get('chain', '')
    if not validate_chain(chain):
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid or missing 'chain': must be INPUT, OUTPUT, or FORWARD"
        ), status=400)
    
    policy = data.get('policy', '')
    if policy.upper() not in ['ACCEPT', 'DROP']:
        return json(create_response(
            ErrorCode.INVALID_PARAM,
            "Invalid 'policy': must be ACCEPT or DROP"
        ), status=400)
    
    result = await set_default_policy(chain, policy)
    status = 200 if result['code'] == ErrorCode.SUCCESS else 400
    return json(result, status=status)


@app.route("/health", methods=["GET"])
async def health_check(request):
    return json({'status': 'ok', 'service': 'sanic-backend'})


# ==================== 启动 ====================

if __name__ == "__main__":
    logger.info(f"启动后端服务: http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)