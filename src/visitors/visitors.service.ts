import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LogVisitDto, VisitorType, VisitorAction } from './dto/log-visit.dto';
import { GetVisitorStatsDto } from './dto/get-visitor-stats.dto';
import { GetTopVisitorsDto } from './dto/get-top-visitors.dto';

export interface VisitorStats {
  date: string;
  admin_total_visits: number;
  admin_unique_visitors: number;
  user_total_visits: number;
  user_unique_visitors: number;
}

export interface TopVisitor {
  visitor_id: number;
  visitor_name: string;
  visitor_type: string;
  visit_count: number;
}

@Injectable()
export class VisitorsService {
  constructor(private readonly prisma: PrismaService) {}

  async logVisit(data: LogVisitDto): Promise<void> {
    console.log('📊 Logging visitor activity:', data);

    await this.prisma.visitorLog.create({
      data: {
        visitor_type: data.visitor_type,
        visitor_id: data.visitor_id,
        action_type: data.action_type,
        page_url: data.page_url,
        ip_address: data.ip_address,
        user_agent: data.user_agent,
      },
    });

    console.log('✅ Visitor activity logged successfully');
  }

  async calculateDailyStats(date: Date): Promise<void> {
    console.log(
      `🔄 Calculating visitor stats for ${date.toISOString().split('T')[0]}`,
    );

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all visitor logs for the day
    const logs = await this.prisma.visitorLog.findMany({
      where: {
        created_at: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    // Calculate admin stats
    const adminLogs = logs.filter((log) => log.visitor_type === 'admin');
    const adminTotalVisits = adminLogs.length;
    const adminUniqueVisitors = new Set(adminLogs.map((log) => log.visitor_id))
      .size;

    // Calculate user stats
    const userLogs = logs.filter((log) => log.visitor_type === 'user');
    const userTotalVisits = userLogs.length;
    const userUniqueVisitors = new Set(userLogs.map((log) => log.visitor_id))
      .size;

    // Upsert daily stats
    await this.prisma.dailyVisitorStats.upsert({
      where: { date: startOfDay },
      update: {
        admin_total_visits: adminTotalVisits,
        admin_unique_visitors: adminUniqueVisitors,
        user_total_visits: userTotalVisits,
        user_unique_visitors: userUniqueVisitors,
      },
      create: {
        date: startOfDay,
        admin_total_visits: adminTotalVisits,
        admin_unique_visitors: adminUniqueVisitors,
        user_total_visits: userTotalVisits,
        user_unique_visitors: userUniqueVisitors,
      },
    });

    console.log(
      `✅ Daily visitor stats calculated: Admin(${adminTotalVisits}/${adminUniqueVisitors}), User(${userTotalVisits}/${userUniqueVisitors})`,
    );
  }

  async getVisitorStats(params: GetVisitorStatsDto): Promise<VisitorStats[]> {
    const { range = 'last_7_days', startDate, endDate } = params;

    let start: Date;
    let end: Date;

    if (range === 'custom' && startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      const now = new Date();
      end = new Date(now);
      start = new Date(now);

      switch (range) {
        case 'last_7_days':
          start.setDate(now.getDate() - 7);
          break;
        case 'last_30_days':
          start.setDate(now.getDate() - 30);
          break;
        case 'last_90_days':
          start.setDate(now.getDate() - 90);
          break;
        default:
          start.setDate(now.getDate() - 7);
      }
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const stats = await this.prisma.dailyVisitorStats.findMany({
      where: {
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { date: 'asc' },
    });

    return stats.map((stat) => ({
      date: stat.date.toISOString().split('T')[0],
      admin_total_visits: stat.admin_total_visits,
      admin_unique_visitors: stat.admin_unique_visitors,
      user_total_visits: stat.user_total_visits,
      user_unique_visitors: stat.user_unique_visitors,
    }));
  }

  async getTopVisitors(params: GetTopVisitorsDto): Promise<TopVisitor[]> {
    const { startDate, endDate, visitor_type, limit = 10 } = params;

    let start: Date;
    let end: Date;

    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      const now = new Date();
      end = new Date(now);
      start = new Date(now);
      start.setDate(now.getDate() - 30); // Default to last 30 days
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const whereClause: any = {
      created_at: {
        gte: start,
        lte: end,
      },
    };

    if (visitor_type) {
      whereClause.visitor_type = visitor_type;
    }

    // Get visitor counts grouped by visitor_id and visitor_type
    const visitorCounts = await this.prisma.visitorLog.groupBy({
      by: ['visitor_id', 'visitor_type'],
      where: whereClause,
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: limit,
    });

    // Get visitor names
    const topVisitors: TopVisitor[] = [];

    for (const visitor of visitorCounts) {
      let visitorName = `ID: ${visitor.visitor_id}`;

      if (visitor.visitor_type === 'admin') {
        const admin = await this.prisma.admin.findUnique({
          where: { id: visitor.visitor_id },
          select: { username: true },
        });
        if (admin) {
          visitorName = admin.username;
        }
      } else if (visitor.visitor_type === 'user') {
        const user = await this.prisma.user.findUnique({
          where: { id: visitor.visitor_id },
          select: { username: true },
        });
        if (user) {
          visitorName = user.username;
        }
      }

      topVisitors.push({
        visitor_id: visitor.visitor_id,
        visitor_name: visitorName,
        visitor_type: visitor.visitor_type,
        visit_count: visitor._count.id,
      });
    }

    return topVisitors;
  }

  async calculateMissingStats(startDate: Date, endDate: Date): Promise<void> {
    console.log(
      `🔄 Calculating missing visitor stats from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
    );

    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const existing = await this.prisma.dailyVisitorStats.findUnique({
        where: { date: current },
      });

      if (!existing) {
        console.log(
          `🔄 Calculating missing stats for ${current.toISOString().split('T')[0]}`,
        );
        await this.calculateDailyStats(new Date(current));
      }

      current.setDate(current.getDate() + 1);
    }

    console.log('✅ Missing visitor stats calculation completed');
  }
}
