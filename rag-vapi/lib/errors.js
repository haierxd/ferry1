export class AppError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

// Never print SDK error bodies, SQL values, headers, keys or bearer tokens.
export function safeError(error) {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  const code = /^[A-Z0-9_]{2,40}$/.test(error?.code || '') ? error.code : 'UPSTREAM_OR_DATABASE_ERROR';
  return { code, message: `外部接口或数据库操作失败${status ? `（HTTP ${status}）` : ''}；请检查服务状态、连接配置和权限。` };
}
