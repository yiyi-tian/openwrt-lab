/**
 * traffic_monitor.c - 基于 libpcap 的网络流量监控程序
 *
 * 功能：捕获流经网卡的数据包，统计各 IP 对的流量信息，包括：
 *   - 源/目的 IP 地址
 *   - 累计收发流量（字节数、数据包数）
 *   - 流量峰值（bps）
 *   - 过去 2s / 10s / 40s 的平均流量
 *
 * 编译：gcc -o traffic_monitor traffic_monitor.c -lpcap -lpthread
 * 运行：./traffic_monitor [网卡名] [输出文件路径]
 *   例：./traffic_monitor eth0 /tmp/traffic_stats.json
 *
 * 输出：周期性将统计数据写入 JSON 文件，同时在终端打印摘要
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>
#include <pthread.h>
#include <arpa/inet.h>
#include <netinet/ip.h>
#include <netinet/ip6.h>
#include <netinet/tcp.h>
#include <netinet/udp.h>
#include <net/ethernet.h>
#include <sys/types.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <pcap.h>

/* ========== 常量定义 ========== */
#define MAX_FLOWS           8192       /* 最大流记录数 */
#define HISTORY_SIZE        40         /* 历史窗口大小（秒），支持最长 40s 平均 */
#define STATS_INTERVAL      1          /* 统计输出间隔（秒） */
#define MAX_IP_STR_LEN      46         /* IPv6 地址最大长度 */

/* ========== 数据结构 ========== */

/* 流量历史记录（每秒一个采样点） */
typedef struct {
    uint64_t bytes;          /* 该秒内传输的字节数 */
    uint64_t packets;        /* 该秒内传输的数据包数 */
    time_t   timestamp;      /* 采样时间戳 */
} traffic_sample_t;

/* 单个 IP 流的统计信息 */
typedef struct {
    uint32_t         src_ip;              /* 源 IP（IPv4） */
    uint32_t         dst_ip;              /* 目的 IP（IPv4） */
    uint8_t          protocol;            /* IP 协议号（6=TCP, 17=UDP） */
    uint16_t         src_port;            /* 源端口 */
    uint16_t         dst_port;            /* 目的端口 */

    uint64_t         total_bytes;         /* 累计字节数 */
    uint64_t         total_packets;       /* 累计数据包数 */

    uint64_t         peak_rate_bps;       /* 历史峰值速率（bps） */

    /* 环形缓冲区：存储最近 HISTORY_SIZE 秒的每秒流量 */
    traffic_sample_t history[HISTORY_SIZE];
    int              history_idx;         /* 当前写入位置 */
    int              history_count;       /* 已填充的采样数（≤ HISTORY_SIZE） */

    uint64_t         current_bytes;       /* 当前秒内累计字节（用于聚合） */
    uint64_t         current_packets;     /* 当前秒内累计包数 */
    time_t           current_second;      /* 当前采样的秒时间戳 */

    time_t           first_seen;          /* 首次见到该流的时间 */
    time_t           last_seen;           /* 最后更新时间 */
} flow_entry_t;

/* 全局流表 */
static flow_entry_t flows[MAX_FLOWS];
static int          flow_count = 0;
static pthread_mutex_t flow_mutex = PTHREAD_MUTEX_INITIALIZER;

/* 全局控制 */
static volatile int running = 1;
static const char  *output_file = "/tmp/traffic_stats.json";
static pcap_t      *handle = NULL;

/* ========== 本机 IP 地址 ========== */
static int      local_ip_count = 0;
static uint32_t local_ips[16];  /* 最多存储 16 个本机 IP */

/* ========== 获取本机 IP 地址 ========== */
static void get_local_ips(const char *device) {
    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        fprintf(stderr, "[WARN] 无法创建 socket 获取本机 IP，将记录所有流量\n");
        return;
    }

    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, device, IFNAMSIZ - 1);

    /* 获取主 IP */
    if (ioctl(sock, SIOCGIFADDR, &ifr) == 0) {
        struct sockaddr_in *addr = (struct sockaddr_in *)&ifr.ifr_addr;
        if (addr->sin_family == AF_INET && addr->sin_addr.s_addr != 0) {
            local_ips[local_ip_count++] = addr->sin_addr.s_addr;
            char ip_str[INET_ADDRSTRLEN];
            inet_ntop(AF_INET, &addr->sin_addr, ip_str, sizeof(ip_str));
            printf("[INFO] 本机 IP: %s\n", ip_str);
        }
    } else {
        fprintf(stderr, "[WARN] 无法获取接口 %s 的 IP 地址，将记录所有流量\n", device);
    }

    /* 获取子网掩码 */
    if (ioctl(sock, SIOCGIFNETMASK, &ifr) == 0) {
        struct sockaddr_in *mask = (struct sockaddr_in *)&ifr.ifr_netmask;
        if (mask->sin_family == AF_INET) {
            char mask_str[INET_ADDRSTRLEN];
            inet_ntop(AF_INET, &mask->sin_addr, mask_str, sizeof(mask_str));
            printf("[INFO] 子网掩码: %s\n", mask_str);
        }
    }

    close(sock);

    if (local_ip_count == 0) {
        printf("[INFO] 未获取到本机 IP，将记录所有流量（包括 INPUT/OUTPUT）\n");
    } else {
        printf("[INFO] 已获取 %d 个本机 IP，将只记录 FORWARD 流量\n", local_ip_count);
    }
}

/* ========== 工具函数 ========== */

/* 查找或创建流记录 */
static flow_entry_t* find_or_create_flow(uint32_t src_ip, uint32_t dst_ip,
                                          uint8_t protocol, uint16_t src_port,
                                          uint16_t dst_port) {
    int i;
    /* 查找已存在的流 */
    for (i = 0; i < flow_count; i++) {
        if (flows[i].src_ip == src_ip &&
            flows[i].dst_ip == dst_ip &&
            flows[i].protocol == protocol &&
            flows[i].src_port == src_port &&
            flows[i].dst_port == dst_port) {
            return &flows[i];
        }
    }

    /* 创建新流 */
    if (flow_count >= MAX_FLOWS) {
        /* 流表已满，淘汰最旧的未活动流 */
        int oldest = 0;
        for (i = 1; i < flow_count; i++) {
            if (flows[i].last_seen < flows[oldest].last_seen) {
                oldest = i;
            }
        }
        memset(&flows[oldest], 0, sizeof(flow_entry_t));
        i = oldest;
    } else {
        i = flow_count++;
    }

    flows[i].src_ip = src_ip;
    flows[i].dst_ip = dst_ip;
    flows[i].protocol = protocol;
    flows[i].src_port = src_port;
    flows[i].dst_port = dst_port;
    flows[i].first_seen = time(NULL);
    flows[i].history_idx = 0;
    flows[i].history_count = 0;

    return &flows[i];
}

/* 计算指定窗口的平均速率 */
static double calc_avg_rate(flow_entry_t *flow, int window_seconds) {
    int count = 0;
    uint64_t total = 0;
    int idx = flow->history_idx;
    int i;

    if (window_seconds > flow->history_count) {
        window_seconds = flow->history_count;
    }
    if (window_seconds <= 0) return 0.0;

    for (i = 0; i < window_seconds; i++) {
        idx = (idx - 1 + HISTORY_SIZE) % HISTORY_SIZE;
        total += flow->history[idx].bytes;
        count++;
    }

    return count > 0 ? (double)total * 8.0 / (double)count : 0.0;  /* bps */
}

/* 获取当前速率 */
static double calc_current_rate_bps(flow_entry_t *flow) {
    if (flow->history_count == 0) return 0.0;
    int last_idx = (flow->history_idx - 1 + HISTORY_SIZE) % HISTORY_SIZE;
    return (double)flow->history[last_idx].bytes * 8.0;  /* bytes -> bits per sec */
}

/* 推进历史采样（每秒调用一次） */
static void advance_history(flow_entry_t *flow) {
    /* 将当前秒的数据写入环形缓冲区 */
    flow->history[flow->history_idx].bytes = flow->current_bytes;
    flow->history[flow->history_idx].packets = flow->current_packets;
    flow->history[flow->history_idx].timestamp = time(NULL);

    /* 更新峰值 */
    uint64_t rate_bps = flow->current_bytes * 8;
    if (rate_bps > flow->peak_rate_bps) {
        flow->peak_rate_bps = rate_bps;
    }

    /* 推进索引 */
    flow->history_idx = (flow->history_idx + 1) % HISTORY_SIZE;
    if (flow->history_count < HISTORY_SIZE) {
        flow->history_count++;
    }

    /* 重置当前计数器 */
    flow->current_bytes = 0;
    flow->current_packets = 0;
}

/* 将 IP 地址转换为字符串 */
static const char* ip_to_str(uint32_t ip, char *buf, size_t len) {
    struct in_addr addr;
    addr.s_addr = ip;
    return inet_ntop(AF_INET, &addr, buf, len);
}

/* 获取协议名称 */
static const char* protocol_name(uint8_t proto) {
    switch (proto) {
        case 6:  return "TCP";
        case 17: return "UDP";
        case 1:  return "ICMP";
        default: return "OTHER";
    }
}

/* ========== JSON 输出 ========== */

/* 将统计数据写入 JSON 文件 */
static void write_stats_json(const char *filepath) {
    FILE *fp = fopen(filepath, "w");
    if (!fp) {
        fprintf(stderr, "[ERROR] 无法写入文件: %s\n", filepath);
        return;
    }

    time_t now = time(NULL);
    char time_buf[64];
    strftime(time_buf, sizeof(time_buf), "%Y-%m-%d %H:%M:%S", localtime(&now));

    pthread_mutex_lock(&flow_mutex);

    fprintf(fp, "{\n");
    fprintf(fp, "  \"timestamp\": %ld,\n", (long)now);
    fprintf(fp, "  \"datetime\": \"%s\",\n", time_buf);
    fprintf(fp, "  \"total_flows\": %d,\n", flow_count);
    fprintf(fp, "  \"flows\": [\n");

    int active_flows = 0;
    for (int i = 0; i < flow_count; i++) {
        flow_entry_t *f = &flows[i];
        /* 跳过 60 秒内没有活动的流 */
        if (now - f->last_seen > 60) continue;

        char src_ip_str[MAX_IP_STR_LEN], dst_ip_str[MAX_IP_STR_LEN];

        if (active_flows > 0) fprintf(fp, ",\n");

        fprintf(fp, "    {\n");
        fprintf(fp, "      \"src_ip\": \"%s\",\n",
                ip_to_str(f->src_ip, src_ip_str, sizeof(src_ip_str)));
        fprintf(fp, "      \"dst_ip\": \"%s\",\n",
                ip_to_str(f->dst_ip, dst_ip_str, sizeof(dst_ip_str)));
        fprintf(fp, "      \"protocol\": \"%s\",\n", protocol_name(f->protocol));
        fprintf(fp, "      \"src_port\": %u,\n", f->src_port);
        fprintf(fp, "      \"dst_port\": %u,\n", f->dst_port);
        fprintf(fp, "      \"total_bytes\": %llu,\n", (unsigned long long)f->total_bytes);
        fprintf(fp, "      \"total_packets\": %llu,\n", (unsigned long long)f->total_packets);
        fprintf(fp, "      \"current_rate_bps\": %.2f,\n", calc_current_rate_bps(f));
        fprintf(fp, "      \"peak_rate_bps\": %llu,\n", (unsigned long long)f->peak_rate_bps);
        fprintf(fp, "      \"avg_rate_2s_bps\": %.2f,\n", calc_avg_rate(f, 2));
        fprintf(fp, "      \"avg_rate_10s_bps\": %.2f,\n", calc_avg_rate(f, 10));
        fprintf(fp, "      \"avg_rate_40s_bps\": %.2f\n", calc_avg_rate(f, 40));
        fprintf(fp, "    }");

        active_flows++;
    }

    fprintf(fp, "\n  ]\n");
    fprintf(fp, "}\n");

    pthread_mutex_unlock(&flow_mutex);
    fclose(fp);
}

static void format_rate(double bps, char *buf, size_t len) {
    if (bps >= 1e9) snprintf(buf, len, "%.1f Gbps", bps / 1e9);
    else if (bps >= 1e6) snprintf(buf, len, "%.1f Mbps", bps / 1e6);
    else if (bps >= 1e3) snprintf(buf, len, "%.1f Kbps", bps / 1e3);
    else snprintf(buf, len, "%.0f bps", bps);
}

/* 在终端打印统计摘要 */
static void print_stats_console(void) {
    time_t now = time(NULL);
    char time_buf[64];
    strftime(time_buf, sizeof(time_buf), "%Y-%m-%d %H:%M:%S", localtime(&now));

    printf("\n\033[2J\033[H");  /* 清屏 */
    printf("╔══════════════════════════════════════════════════════════════════════════════════╗\n");
    printf("║              网络流量监控 - %s                                     ║\n", time_buf);
    printf("╠════════════════════════════╤══════════════════════════╤══════════╤══════╤═══════╣\n");
    printf("║ %-26s │ %-24s │ %8s │ %4s │ %5s ║\n",
           "源地址 → 目的地址", "协议:端口", "当前速率", "峰值", "2s平均");
    printf("╟────────────────────────────┼──────────────────────────┼──────────┼──────┼───────╢\n");

    pthread_mutex_lock(&flow_mutex);

    int shown = 0;
    for (int i = 0; i < flow_count && shown < 20; i++) {
        flow_entry_t *f = &flows[i];
        if (now - f->last_seen > 30) continue;  /* 只显示最近 30s 活动的流 */

        char src_ip_str[MAX_IP_STR_LEN], dst_ip_str[MAX_IP_STR_LEN];
        char addr_pair[60];
        snprintf(addr_pair, sizeof(addr_pair), "%s → %s",
                 ip_to_str(f->src_ip, src_ip_str, sizeof(src_ip_str)),
                 ip_to_str(f->dst_ip, dst_ip_str, sizeof(dst_ip_str)));

        char proto_info[20];
        snprintf(proto_info, sizeof(proto_info), "%s:%u→%u",
                 protocol_name(f->protocol), f->src_port, f->dst_port);

        double current_bps = calc_current_rate_bps(f);
        char rate_str[20], peak_str[20], avg2_str[20];

        format_rate(current_bps, rate_str, sizeof(rate_str));
        format_rate((double)f->peak_rate_bps, peak_str, sizeof(peak_str));
        format_rate(calc_avg_rate(f, 2), avg2_str, sizeof(avg2_str));

        printf("║ %-26s │ %-24s │ %8s │ %4s │ %5s ║\n",
               addr_pair, proto_info, rate_str, peak_str, avg2_str);
        shown++;
    }

    if (shown == 0) {
        printf("║                         等待网络流量...                                            ║\n");
    }

    pthread_mutex_unlock(&flow_mutex);

    printf("╚════════════════════════════╧══════════════════════════╧══════════╧══════╧═══════╝\n");
    printf("活跃流: %d | 按 Ctrl+C 退出\n", shown);
}

/* ========== 数据包处理 ========== */

/* 数据包回调函数 */
static void packet_handler(u_char *user, const struct pcap_pkthdr *pkthdr,
                           const u_char *packet) {
    (void)user;

    /* 跳过以太网头部（14 字节） */
    if (pkthdr->len < sizeof(struct ether_header)) return;
    const struct ether_header *eth = (const struct ether_header *)packet;

    /* 仅处理 IPv4 */
    if (ntohs(eth->ether_type) != ETHERTYPE_IP) return;
    if (pkthdr->len < sizeof(struct ether_header) + sizeof(struct ip)) return;

    const struct ip *ip_hdr = (const struct ip *)(packet + sizeof(struct ether_header));
    uint8_t protocol = ip_hdr->ip_p;
    uint32_t src_ip = ip_hdr->ip_src.s_addr;
    uint32_t dst_ip = ip_hdr->ip_dst.s_addr;
    uint16_t src_port = 0, dst_port = 0;

    /* ===== 过滤本机流量，只保留 FORWARD 链的包 ===== */
    if (local_ip_count > 0) {
        int skip = 0;
        for (int i = 0; i < local_ip_count; i++) {
            if (src_ip == local_ips[i] || dst_ip == local_ips[i]) {
                skip = 1;
                break;
            }
        }
        if (skip) return;  /* 源或目的是本机 IP，跳过（INPUT/OUTPUT 流量） */
    }

    /* 解析 TCP/UDP 端口 */
    int ip_hdr_len = ip_hdr->ip_hl * 4;
    if (protocol == IPPROTO_TCP &&
        pkthdr->len >= sizeof(struct ether_header) + ip_hdr_len + sizeof(struct tcphdr)) {
        const struct tcphdr *tcp = (const struct tcphdr *)(packet + sizeof(struct ether_header) + ip_hdr_len);
        src_port = ntohs(tcp->th_sport);
        dst_port = ntohs(tcp->th_dport);
    } else if (protocol == IPPROTO_UDP &&
               pkthdr->len >= sizeof(struct ether_header) + ip_hdr_len + sizeof(struct udphdr)) {
        const struct udphdr *udp = (const struct udphdr *)(packet + sizeof(struct ether_header) + ip_hdr_len);
        src_port = ntohs(udp->uh_sport);
        dst_port = ntohs(udp->uh_dport);
    }

    /* 更新流统计 */
    pthread_mutex_lock(&flow_mutex);

    flow_entry_t *flow = find_or_create_flow(src_ip, dst_ip, protocol, src_port, dst_port);
    time_t now = time(NULL);

    /* 如果进入新的一秒，推进历史窗口 */
    if (now != flow->current_second && flow->current_second != 0) {
        advance_history(flow);
    }
    flow->current_second = now;

    flow->total_bytes += pkthdr->len;
    flow->total_packets++;
    flow->current_bytes += pkthdr->len;
    flow->current_packets++;
    flow->last_seen = now;

    pthread_mutex_unlock(&flow_mutex);
}

/* ========== 统计输出线程 ========== */

static void* stats_thread(void *arg) {
    (void)arg;

    while (running) {
        sleep(STATS_INTERVAL);

        /* 推进所有活动流的历史窗口 */
        pthread_mutex_lock(&flow_mutex);
        time_t now = time(NULL);
        for (int i = 0; i < flow_count; i++) {
            if (flows[i].current_second != now && flows[i].current_second != 0) {
                advance_history(&flows[i]);
                flows[i].current_second = now;
            }
        }
        pthread_mutex_unlock(&flow_mutex);

        /* 写入 JSON 文件 */
        write_stats_json(output_file);

        /* 终端输出 */
        print_stats_console();
    }

    return NULL;
}

/* ========== 信号处理 ========== */

static void signal_handler(int sig) {
    (void)sig;
    running = 0;
    if (handle) {
        pcap_breakloop(handle);
    }
}

/* ========== 主函数 ========== */

void print_usage(const char *prog) {
    printf("用法: %s [网卡名] [输出文件路径]\n", prog);
    printf("  网卡名         - 监听的网络接口（默认: eth0）\n");
    printf("  输出文件路径   - JSON 统计输出路径（默认: /tmp/traffic_stats.json）\n");
    printf("\n  例: %s eth0 /tmp/traffic_stats.json\n", prog);
    printf("      %s br-lan\n", prog);
}

int main(int argc, char *argv[]) {
    const char *device = "eth0";

    if (argc >= 2) {
        if (strcmp(argv[1], "-h") == 0 || strcmp(argv[1], "--help") == 0) {
            print_usage(argv[0]);
            return 0;
        }
        device = argv[1];
    }
    if (argc >= 3) {
        output_file = argv[2];
    }

    /* 安装信号处理 */
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    /* 查找可用的网络设备 */
    char errbuf[PCAP_ERRBUF_SIZE];
    pcap_if_t *alldevs = NULL;

    if (pcap_findalldevs(&alldevs, errbuf) == -1) {
        fprintf(stderr, "[ERROR] 查找网络设备失败: %s\n", errbuf);
    } else {
        printf("[INFO] 可用网络接口:\n");
        int dev_count = 0;
        for (pcap_if_t *d = alldevs; d != NULL; d = d->next) {
            printf("  %d: %s", ++dev_count, d->name);
            if (d->description) printf(" - %s", d->description);
            printf("\n");
        }
        pcap_freealldevs(alldevs);
    }

    /* 打开网络接口 */
    printf("\n[INFO] 打开网络接口: %s\n", device);
    handle = pcap_open_live(device, BUFSIZ, 1, 1000, errbuf);
    if (!handle) {
        fprintf(stderr, "[ERROR] 无法打开接口 %s: %s\n", device, errbuf);
        fprintf(stderr, "[HINT] 请使用 root 权限运行，或检查网卡名称是否正确\n");
        return 1;
    }

    /* 获取本机 IP 地址 */
    get_local_ips(device);

    /* 设置过滤器（捕获所有 IP 流量） */
    struct bpf_program fp;
    bpf_u_int32 net = 0, mask = 0;
    if (pcap_lookupnet(device, &net, &mask, errbuf) == -1) {
        fprintf(stderr, "[WARN] 无法获取网络地址: %s\n", errbuf);
    }
    if (pcap_compile(handle, &fp, "ip", 0, mask) == -1) {
        fprintf(stderr, "[ERROR] 编译过滤器失败: %s\n", pcap_geterr(handle));
        pcap_close(handle);
        return 1;
    }
    if (pcap_setfilter(handle, &fp) == -1) {
        fprintf(stderr, "[ERROR] 设置过滤器失败: %s\n", pcap_geterr(handle));
        pcap_freecode(&fp);
        pcap_close(handle);
        return 1;
    }
    pcap_freecode(&fp);

    printf("[INFO] 过滤器: ip (所有 IPv4 流量)\n");
    printf("[INFO] 输出文件: %s\n", output_file);
    printf("[INFO] 开始捕获流量... (按 Ctrl+C 停止)\n");

    /* 启动统计输出线程 */
    pthread_t stats_tid;
    if (pthread_create(&stats_tid, NULL, stats_thread, NULL) != 0) {
        fprintf(stderr, "[ERROR] 创建统计线程失败\n");
        pcap_close(handle);
        return 1;
    }

    /* 主循环：捕获数据包 */
    pcap_loop(handle, -1, packet_handler, NULL);

    /* 清理 */
    running = 0;
    pthread_join(stats_tid, NULL);
    pcap_close(handle);

    printf("\n[INFO] 流量监控已停止。最后统计已写入: %s\n", output_file);
    return 0;
}