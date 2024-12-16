interface ServerInfo {
    https_port: string;
    port: string;
    rtmp_port: string;
    server_protocol: string;
    time_now: string;
    timestamp_now: number;
    timezone: string;
    url: string;
}

interface UserInfo {
    active_cons: string;
    allowed_output_formats: string[];
    auth: number;
    created_at: string;
    exp_date: string;
    is_trial: string;
    max_connections: string;
    message: string;
    password: string;
    status: string;
    username: string;
}

export interface XtreamAccountInfo {
    server_info: ServerInfo;
    user_info: UserInfo;
}
