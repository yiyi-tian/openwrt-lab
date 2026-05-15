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
        "src_ip": "192.168.1.100",
        "dst_ip": "142.250.80.46",
        "src_port": 54321,
        "dst_port": 443,
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
| data.connections[].src_ip | string | 源 IP 地址 |
| data.connections[].dst_ip | string | 目标 IP 地址 |
| data.connections[].src_port | int | 源端口号 |
| data.connections[].dst_port | int | 目标端口号 |
| data.connections[].protocol | string | 传输层协议（TCP/UDP） |
| data.connections[].bytes_in | int | 该连接入站字节数 |
| data.connections[].bytes_out | int | 该连接出站字节数 |
| data.top_talkers | array | 流量 Top N 主机列表 |


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
    "connections": 12,
    "protocols": {
      "TCP": 80,
      "UDP": 20
    },
    "top_destinations": [
      {
        "dst_ip": "142.250.80.46",
        "port": 443,
        "bytes": 20971520
      }
    ]
  }
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