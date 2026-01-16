import { Injectable } from '@nestjs/common';

interface LoginAttempt {
  count: number;
  lockedUntil: Date | null;
  lastAttempt: Date;
}

@Injectable()
export class LoginAttemptService {
  // 使用内存Map存储登录尝试（生产环境建议使用Redis）
  private readonly loginAttempts = new Map<string, LoginAttempt>();

  // 配置
  private readonly MAX_ATTEMPTS = 5; // 最大失败次数
  private readonly LOCK_DURATION = 15 * 60 * 1000; // 锁定15分钟
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 每小时清理一次过期记录

  constructor() {
    // 定期清理过期的记录
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  // 记录登录失败
  recordFailure(username: string): {
    isLocked: boolean;
    remainingAttempts: number;
    lockedUntil: Date | null;
  } {
    const key = `user:${username}`;
    const now = new Date();
    let attempt = this.loginAttempts.get(key);

    if (!attempt) {
      attempt = {
        count: 0,
        lockedUntil: null,
        lastAttempt: now,
      };
    }

    // 如果账户已锁定，检查是否已过期
    if (attempt.lockedUntil && attempt.lockedUntil > now) {
      return {
        isLocked: true,
        remainingAttempts: 0,
        lockedUntil: attempt.lockedUntil,
      };
    }

    // 如果锁定已过期，重置计数
    if (attempt.lockedUntil && attempt.lockedUntil <= now) {
      attempt.count = 0;
      attempt.lockedUntil = null;
    }

    // 增加失败次数
    attempt.count++;
    attempt.lastAttempt = now;

    // 如果达到最大失败次数，锁定账户
    if (attempt.count >= this.MAX_ATTEMPTS) {
      attempt.lockedUntil = new Date(now.getTime() + this.LOCK_DURATION);
    }

    this.loginAttempts.set(key, attempt);

    return {
      isLocked: attempt.lockedUntil !== null,
      remainingAttempts: Math.max(0, this.MAX_ATTEMPTS - attempt.count),
      lockedUntil: attempt.lockedUntil,
    };
  }

  // 记录登录成功，清除失败记录
  recordSuccess(username: string): void {
    const key = `user:${username}`;
    this.loginAttempts.delete(key);
  }

  // 检查账户是否被锁定
  isLocked(username: string): { isLocked: boolean; lockedUntil: Date | null } {
    const key = `user:${username}`;
    const attempt = this.loginAttempts.get(key);

    if (!attempt) {
      return { isLocked: false, lockedUntil: null };
    }

    const now = new Date();
    if (attempt.lockedUntil && attempt.lockedUntil > now) {
      return { isLocked: true, lockedUntil: attempt.lockedUntil };
    }

    // 锁定已过期，清除记录
    if (attempt.lockedUntil && attempt.lockedUntil <= now) {
      this.loginAttempts.delete(key);
      return { isLocked: false, lockedUntil: null };
    }

    return { isLocked: false, lockedUntil: null };
  }

  // 清理过期的记录
  private cleanup(): void {
    const now = new Date();
    for (const [key, attempt] of this.loginAttempts.entries()) {
      // 如果锁定已过期且超过1小时没有活动，删除记录
      if (
        (!attempt.lockedUntil || attempt.lockedUntil <= now) &&
        now.getTime() - attempt.lastAttempt.getTime() > this.CLEANUP_INTERVAL
      ) {
        this.loginAttempts.delete(key);
      }
    }
  }
}
