# API 接口文档

## 基础信息

- **基础URL**: `http://localhost:8000/api`
- **内容类型**: `application/json`
- **字符编码**: UTF-8

---

## 一、流量监控接口

### 1.1 获取实时流量数据

获取当前所有网络连接的流量统计信息。

**请求**

```
GET /api/traffic/current
```

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "timestamp": 1715778000,
    "total": {
      "bytes_in": 104857600,
      "bytes_out": 52428800,
      "packets_in": 150000,
      "packets_out": 120000
    },
    "connections": [
      {
        "src": "192.168.1.100",
        "dst": "142.250.80.46",
        "sport": 54321,
        "dport": 443,
        "protocol": "TCP",
        "bytes_in": 20480,
        "bytes_out": 10240,
        "packets_in": 150,
        "packets_out": 120,
        "first_seen": 1715777900,
        "last_seen": 1715778000
      }
    ],
    "top_talkers": [
      {
        "ip": "192.168.1.100",
        "bytes_total": 30720,
        "connections": 5
      }
    ]
  }
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| code | int | 状态码，0 表示成功 |
| message | string | 状态描述 |
| data.timestamp | int | 数据采集时间戳（Unix 秒） |
| data.total | object | 总体流量统计 |
| data.total.bytes_in | int | 总入站字节数 |
| data.total.bytes_out | int | 总出站字节数 |
| data.total.packets_in | int | 总入站数据包数 |
| data.total.packets_out | int | 总出站数据包数 |
| data.connections | array | 活跃连接列表 |
| data.connections[].src | string | 源 IP 地址 |
| data.connections[].dst | string | 目标 IP 地址 |
| data.connections[].sport | int | 源端口号 |
| data.connections[].dport | int | 目标端口号 |
| data.connections[].protocol | string | 传输层协议（TCP/UDP/ICMP） |
| data.connections[].bytes_in | int | 该连接入站字节数 |
| data.connections[].bytes_out | int | 该连接出站字节数 |
| data.connections[].packets_in | int | 该连接入站包数 |
| data.connections[].packets_out | int | 该连接出站包数 |
| data.connections[].first_seen | int | 首次出现时间戳 |
| data.connections[].last_seen | int | 最后出现时间戳 |
| data.top_talkers | array | 流量 Top N 主机列表 |
| data.top_talkers[].ip | string | 主机 IP 地址 |
| data.top_talkers[].bytes_total | int | 总流量字节数 |
| data.top_talkers[].connections | int | 连接数 |

**错误响应示例**

```json
{
  "code": 1004,
  "message": "Traffic data is temporarily unavailable",
  "detail": "Failed to parse flow data: Expecting value at line 5 column 10"
}
```

```json
{
  "code": 2001,
  "message": "Internal server error",
  "detail": "Permission denied: /tmp/flow_data.json"
}
```

### 1.2 获取历史流量统计

获取指定时间范围内的流量历史数据。

**请求**

```
GET /api/traffic/history?start=1715774400&end=1715778000&interval=60
```

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| start | int | 是 | 开始时间戳（Unix 秒） |
| end | int | 是 | 结束时间戳（Unix 秒） |
| interval | int | 否 | 聚合间隔（秒），默认 60 |

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "start": 1715774400,
    "end": 1715778000,
    "interval": 60,
    "series": [
      {
        "timestamp": 1715774460,
        "bytes_in": 102400,
        "bytes_out": 51200,
        "packets_in": 200,
        "packets_out": 180
      },
      {
        "timestamp": 1715774520,
        "bytes_in": 115200,
        "bytes_out": 60800,
        "packets_in": 230,
        "packets_out": 210
      }
    ]
  }
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| data.start | int | 开始时间戳 |
| data.end | int | 结束时间戳 |
| data.interval | int | 聚合间隔（秒） |
| data.series | array | 时序数据点 |
| data.series[].timestamp | int | 该数据点对应的时间戳 |
| data.series[].bytes_in | int | 该时间窗口内的入站字节数 |
| data.series[].bytes_out | int | 该时间窗口内的出站字节数 |
| data.series[].packets_in | int | 该时间窗口内的入站包数 |
| data.series[].packets_out | int | 该时间窗口内的出站包数 |

**错误响应示例**

```json
{
  "code": 1001,
  "message": "Missing required parameter: start",
  "detail": ""
}
```

```json
{
  "code": 1001,
  "message": "Invalid parameter: start must be a positive integer",
  "detail": ""
}
```

---

### 1.3 获取指定 IP 的流量详情

**请求**

```
GET /api/traffic/ip/<ip_address>
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| ip_address | string | 目标 IP 地址 |

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "ip": "192.168.1.100",
    "hostname": "desktop-pc",
    "mac": "aa:bb:cc:dd:ee:ff",
    "bytes_in": 52428800,
    "bytes_out": 104857600,
    "packets_in": 75000,
    "packets_out": 120000,
    "connections": 12,
    "first_seen": 1715774400,
    "last_seen": 1715778000,
    "protocols": {
      "TCP": 80,
      "UDP": 20
    },
    "top_destinations": [
      {
        "dst": "142.250.80.46",
        "dport": 443,
        "protocol": "TCP",
        "bytes": 20971520,
        "bytes_percent": 40
      }
    ]
  }
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| data.ip | string | IP 地址 |
| data.hostname | string | 主机名（如有，可通过 ARP/NDP 或 DNS 反向解析获取） |
| data.mac | string | MAC 地址（如有，可通过 ARP 表获取） |
| data.bytes_in | int | 总入站字节数 |
| data.bytes_out | int | 总出站字节数 |
| data.packets_in | int | 总入站包数 |
| data.packets_out | int | 总出站包数 |
| data.connections | int | 活跃连接数 |
| data.first_seen | int | 首次出现时间戳 |
| data.last_seen | int | 最后出现时间戳 |
| data.protocols | object | 协议分布（键为协议名，值为连接数占比） |
| data.top_destinations | array | 通信最多的目标地址列表 |
| data.top_destinations[].dst | string | 目标 IP 地址 |
| data.top_destinations[].dport | int | 目标端口号 |
| data.top_destinations[].protocol | string | 协议类型 |
| data.top_destinations[].bytes | int | 通信字节数 |
| data.top_destinations[].bytes_percent | int | 占总流量的百分比 |

**错误响应示例**

```json
{
  "code": 1001,
  "message": "Invalid IP address format",
  "detail": "192.168.1.999 is not a valid IPv4 address"
}
```

```json
{
  "code": 1004,
  "message": "No traffic data found for IP: 10.0.0.99",
  "detail": ""
}
```

---

## 二、防火墙管理接口

### 2.1 获取防火墙规则列表

**请求**

```
GET /api/firewall/rules
```

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chain | string | 否 | 过滤链名称（INPUT/OUTPUT/FORWARD），默认返回所有 |

**响应示例**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "rules": [
      {
        "num": 1,
        "chain": "INPUT",
        "target": "ACCEPT",
        "protocol": "tcp",
        "src": "0.0.0.0/0",
        "dst": "0.0.0.0/0",
        "sport": "",
        "dport": "22",
        "in_iface": "",
        "out_iface": "",
        "bytes": 1048576,
        "packets": 2048
      },
      {
        "num": 2,
        "chain": "INPUT",
        "target": "DROP",
        "protocol": "tcp",
        "src": "192.168.1.200",
        "dst": "0.0.0.0/0",
        "sport": "",
        "dport": "80",
        "in_iface": "eth0",
        "out_iface": "",
        "bytes": 0,
        "packets": 0
      }
    ],
    "default_policy": {
      "INPUT": "ACCEPT",
      "OUTPUT": "ACCEPT",
      "FORWARD": "DROP"
    }
  }
}
```

---

### 2.2 添加防火墙规则

**请求**

```
POST /api/firewall/rules
Content-Type: application/json
```

**请求体**

```json
{
  "chain": "INPUT",
  "target": "DROP",
  "protocol": "tcp",
  "src": "192.168.1.200",
  "dst": "",
  "sport": "",
  "dport": "80",
  "in_iface": "eth0",
  "out_iface": "",
  "comment": "Block HTTP from specific IP"
}
```

**请求体字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chain | string | 是 | 规则链：INPUT / OUTPUT / FORWARD |
| target | string | 是 | 动作：ACCEPT / DROP / REJECT |
| protocol | string | 否 | 协议：tcp / udp / icmp，空字符串表示所有 |
| src | string | 否 | 源地址（CIDR 格式），空字符串表示任意 |
| dst | string | 否 | 目标地址（CIDR 格式），空字符串表示任意 |
| sport | string | 否 | 源端口（支持范围格式 1024:2048），空字符串表示任意 |
| dport | string | 否 | 目标端口，空字符串表示任意 |
| in_iface | string | 否 | 入站网卡接口，空字符串表示所有 |
| out_iface | string | 否 | 出站网卡接口，空字符串表示所有 |
| comment | string | 否 | 规则备注 |

**成功响应**

```json
{
  "code": 0,
  "message": "Rule added successfully",
  "data": {
    "rule_num": 5,
    "chain": "INPUT"
  }
}
```

**错误响应**

```json
{
  "code": 1001,
  "message": "Invalid chain: must be INPUT, OUTPUT, or FORWARD"
}
```

---

### 2.3 删除防火墙规则

**请求**

```
DELETE /api/firewall/rules
Content-Type: application/json
```

**请求体**

```json
{
  "chain": "INPUT",
  "rule_num": 2
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chain | string | 是 | 规则所在链 |
| rule_num | int | 是 | 规则序号（从规则列表接口获取） |

**成功响应**

```json
{
  "code": 0,
  "message": "Rule deleted successfully"
}
```

---

### 2.4 清空防火墙规则

**请求**

```
POST /api/firewall/flush
Content-Type: application/json
```

**请求体**

```json
{
  "chain": "INPUT"
}
```

> 不传 `chain` 或传空字符串则清空所有链。

**成功响应**

```json
{
  "code": 0,
  "message": "Chain INPUT flushed successfully"
}
```

---

### 2.5 设置默认策略

**请求**

```
PUT /api/firewall/policy
Content-Type: application/json
```

**请求体**

```json
{
  "chain": "INPUT",
  "policy": "DROP"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chain | string | 是 | 规则链：INPUT / OUTPUT / FORWARD |
| policy | string | 是 | 默认策略：ACCEPT / DROP |

**成功响应**

```json
{
  "code": 0,
  "message": "Default policy for INPUT set to DROP"
}
```

---

## 三、通用错误码

| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 1001 | 参数校验失败 |
| 1002 | 规则不存在 |
| 1003 | 脚本执行失败 |
| 1004 | 流量数据不可用 |
| 2001 | 内部服务器错误 |
| 2002 | 权限不足（需要 root 权限执行 iptables 命令） |

**通用错误响应格式**

```json
{
  "code": 1001,
  "message": "Parameter 'chain' is required",
  "detail": ""
}
```

---

## 四、注意事项

1. **权限要求**：防火墙相关接口需要后端进程以 `root` 权限运行，才能调用 `iptables` 命令。
2. **数据刷新频率**：`flow-monitor` 模块每 5 秒更新一次 `/tmp/flow_data.json`，前端轮询间隔建议不小于 3 秒。
3. **规则持久化**：通过 API 添加的 iptables 规则在设备重启后会丢失。如需持久化，需额外执行 `iptables-save` 或在 OpenWrt 的 `/etc/firewall.user` 中配置。
4. **并发读取**：后端读取流量 JSON 文件时内置重试机制（最多 3 次，间隔 100ms），以处理文件正在写入的情况。
5. **CORS 支持**：后端已配置 CORS 中间件，允许前端跨域访问。如需限制来源，请在 `app.py` 中修改 CORS 配置。