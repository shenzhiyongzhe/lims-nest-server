import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AdminsModule } from './admins/admins.module';
import { LoanAccountsModule } from './loanAccounts/loanAccounts.module';
import { RepaymentSchedulesModule } from './repayment-schedules/repayment-schedules.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { ChatModule } from './chat/chat.module';
import { PayeesModule } from './payees/payees.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { OrdersModule } from './orders/orders.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CronJobsModule } from './cron/cron.module';
import { StatisticsModule } from './statistics/statistics.module';
import { RepaymentRecordsModule } from './repayment-records/repayment-records.module';
import { LoanAccountRolesModule } from './loanAccountRoles/loanAccountRoles.module';
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/',
    }),
    PrismaModule,
    UsersModule,
    AdminsModule,
    LoanAccountsModule,
    RepaymentSchedulesModule,
    AuthModule,
    PayeesModule,
    EventsModule,
    ChatModule,
    OrdersModule,
    CronJobsModule,
    StatisticsModule,
    RepaymentRecordsModule,
    LoanAccountRolesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
