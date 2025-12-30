import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import archiver from 'archiver';

@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  // 格式化日期为MySQL格式
  private formatDateForMySQL(date: Date): string {
    // 检查日期是否有效
    if (!date || isNaN(date.getTime())) {
      return '';
    }

    // 使用UTC时间，避免时区问题
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');

    // 检查年份是否有效（不能是0）
    if (year === 0 || year < 1000 || year > 9999) {
      return '';
    }

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // 将值转换为CSV格式（处理特殊字符）
  private escapeCSVValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    // 先处理日期类型（必须在转换为字符串之前）
    // Prisma的DateTime字段返回的是Date对象，但需要确保正确处理
    if (value instanceof Date) {
      const formatted = this.formatDateForMySQL(value);
      if (formatted) {
        return formatted;
      }
      // 如果格式化失败，返回空字符串而不是默认的toString()
      return '';
    }

    // 处理Prisma的DateTime类型（可能是对象但有Date方法）
    if (typeof value === 'object' && value !== null) {
      // 尝试转换为Date对象
      let dateValue: Date | null = null;

      // 如果有toISOString方法，可能是Prisma的DateTime
      if (
        'toISOString' in value &&
        typeof (value as any).toISOString === 'function'
      ) {
        try {
          const isoString = (value as any).toISOString();
          if (isoString && typeof isoString === 'string') {
            dateValue = new Date(isoString);
          }
        } catch {
          // 转换失败，继续后续处理
        }
      }
      // 如果有getTime方法
      else if (
        'getTime' in value &&
        typeof (value as any).getTime === 'function'
      ) {
        try {
          const timestamp = (value as any).getTime();
          if (
            typeof timestamp === 'number' &&
            !isNaN(timestamp) &&
            timestamp > 0
          ) {
            dateValue = new Date(timestamp);
          }
        } catch {
          // 转换失败，继续后续处理
        }
      }
      // 如果有valueOf方法
      else if (
        'valueOf' in value &&
        typeof (value as any).valueOf === 'function'
      ) {
        try {
          const timestamp = (value as any).valueOf();
          if (
            typeof timestamp === 'number' &&
            !isNaN(timestamp) &&
            timestamp > 0
          ) {
            dateValue = new Date(timestamp);
          }
        } catch {
          // 转换失败，继续后续处理
        }
      }
      // 如果有getFullYear方法，可能是Date对象
      else if (
        'getFullYear' in value &&
        typeof (value as any).getFullYear === 'function'
      ) {
        try {
          // 尝试直接使用，可能是Date对象但instanceof检查失败
          const testYear = (value as any).getFullYear();
          if (
            typeof testYear === 'number' &&
            testYear > 0 &&
            testYear < 10000
          ) {
            dateValue = value as Date;
          }
        } catch {
          // 转换失败，继续后续处理
        }
      }

      // 如果成功转换为Date，格式化返回
      if (
        dateValue &&
        dateValue instanceof Date &&
        !isNaN(dateValue.getTime())
      ) {
        const formatted = this.formatDateForMySQL(dateValue);
        if (formatted) {
          return formatted;
        }
      }
      // 如果无法转换为有效日期，返回空字符串
      if (dateValue === null) {
        // 继续后续处理，可能是其他类型的对象
      }
    }

    // 处理Decimal类型（Prisma的Decimal类型）
    if (value && typeof value === 'object' && 'toString' in value) {
      // Prisma的Decimal类型有toString方法
      if (typeof value.toString === 'function') {
        value = value.toString();
      }
    }

    // 处理布尔值
    if (typeof value === 'boolean') {
      value = value ? 'true' : 'false';
    }

    // 转换为字符串
    let str = String(value);

    // 如果包含逗号、引号或换行符，需要用双引号包裹
    if (
      str.includes(',') ||
      str.includes('"') ||
      str.includes('\n') ||
      str.includes('\r')
    ) {
      // 转义双引号：将 " 替换为 ""
      str = str.replace(/"/g, '""');
      // 用双引号包裹
      str = `"${str}"`;
    }

    return str;
  }

  // 将记录数组转换为CSV字符串
  private convertToCSV<T extends Record<string, any>>(
    records: T[],
    fieldNames: string[],
  ): string {
    if (records.length === 0) {
      return fieldNames.join(',') + '\n';
    }

    // 第一行：列名
    const header = fieldNames
      .map((name) => this.escapeCSVValue(name))
      .join(',');
    const lines = [header];

    // 数据行
    for (const record of records) {
      const row = fieldNames
        .map((fieldName) => {
          const value = record[fieldName];
          return this.escapeCSVValue(value);
        })
        .join(',');
      lines.push(row);
    }

    return lines.join('\n');
  }

  // 导出User表
  private async exportUsers(): Promise<string> {
    const users = await this.prisma.user.findMany({
      orderBy: { id: 'asc' },
    });

    const fieldNames = [
      'id',
      'username',
      'password',
      'phone',
      'address',
      'lv',
      'overtime',
      'overdue_time',
      'is_high_risk',
      'createdAt',
      'updatedAt',
    ];

    return this.convertToCSV(users, fieldNames);
  }

  // 导出Admin表
  private async exportAdmins(): Promise<string> {
    const admins = await this.prisma.admin.findMany({
      orderBy: { id: 'asc' },
    });

    const fieldNames = [
      'id',
      'username',
      'password',
      'phone',
      'role',
      'createdAt',
      'updatedAt',
    ];

    return this.convertToCSV(admins, fieldNames);
  }

  // 导出LoanAccount表
  private async exportLoanAccounts(): Promise<string> {
    const loanAccounts = await this.prisma.loanAccount.findMany({
      orderBy: { created_at: 'asc' },
    });

    const fieldNames = [
      'id',
      'user_id',
      'loan_amount',
      'receiving_amount',
      'paid_capital',
      'paid_interest',
      'total_fines',
      'to_hand_ratio',
      'capital',
      'interest',
      'due_start_date',
      'due_end_date',
      'apply_times',
      'status',
      'handling_fee',
      'total_periods',
      'repaid_periods',
      'daily_repayment',
      'risk_controller_id',
      'collector_id',
      'lender_id',
      'company_cost',
      'created_at',
      'created_by',
      'updated_at',
      'status_changed_at',
      'note',
      'last_edit_pay_capital',
      'last_edit_pay_interest',
      'last_edit_fines',
      'early_settlement_capital',
      'last_repayment_date',
      'overdue_count',
    ];

    return this.convertToCSV(loanAccounts, fieldNames);
  }

  // 导出RepaymentSchedule表
  private async exportRepaymentSchedules(): Promise<string> {
    const schedules = await this.prisma.repaymentSchedule.findMany({
      orderBy: [{ loan_id: 'asc' }, { period: 'asc' }],
    });

    const fieldNames = [
      'id',
      'loan_id',
      'period',
      'due_start_date',
      'due_amount',
      'capital',
      'interest',
      'paid_capital',
      'paid_interest',
      'fines',
      'status',
      'paid_amount',
      'paid_at',
      'collected_by_type',
      'operator_admin_id',
      'operator_admin_name',
    ];

    return this.convertToCSV(schedules, fieldNames);
  }

  // 导出RepaymentRecord表
  private async exportRepaymentRecords(): Promise<string> {
    const records = await this.prisma.repaymentRecord.findMany({
      orderBy: { paid_at: 'asc' },
    });

    const fieldNames = [
      'id',
      'loan_id',
      'user_id',
      'paid_amount',
      'paid_at',
      'payment_method',
      'remark',
      'order_id',
      'collected_by_type',
      'actual_collector_id',
      'paid_capital',
      'paid_interest',
      'paid_fines',
      'repayment_schedule_id',
    ];

    return this.convertToCSV(records, fieldNames);
  }

  // 导出PayeeRanking表
  private async exportPayeeRankings(): Promise<string> {
    const rankings = await this.prisma.payeeRanking.findMany({
      orderBy: { id: 'asc' },
    });

    const fieldNames = ['id', 'payee_id', 'decimal_sum', 'updated_at'];

    return this.convertToCSV(rankings, fieldNames);
  }

  // 创建备份ZIP文件
  async createBackupZip(): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        // 导出所有表的数据
        const [
          usersCSV,
          adminsCSV,
          loanAccountsCSV,
          repaymentSchedulesCSV,
          repaymentRecordsCSV,
          payeeRankingsCSV,
        ] = await Promise.all([
          this.exportUsers(),
          this.exportAdmins(),
          this.exportLoanAccounts(),
          this.exportRepaymentSchedules(),
          this.exportRepaymentRecords(),
          this.exportPayeeRankings(),
        ]);

        // 创建ZIP归档
        const archive = archiver('zip', {
          zlib: { level: 9 }, // 最高压缩级别
        });

        const chunks: Buffer[] = [];

        // 收集数据
        archive.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        archive.on('error', (err) => {
          reject(err);
        });

        archive.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        // 添加CSV文件到ZIP
        archive.append(usersCSV, { name: 'users.csv' });
        archive.append(adminsCSV, { name: 'admins.csv' });
        archive.append(loanAccountsCSV, { name: 'loan_accounts.csv' });
        archive.append(repaymentSchedulesCSV, {
          name: 'repayment_schedules.csv',
        });
        archive.append(repaymentRecordsCSV, { name: 'repayment_records.csv' });
        archive.append(payeeRankingsCSV, { name: 'payee_rankings.csv' });

        // 完成归档
        await archive.finalize();
      } catch (error) {
        reject(error);
      }
    });
  }
}
