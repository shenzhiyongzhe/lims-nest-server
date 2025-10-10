import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AdminsModule } from './admins/admins.module';
import { LoanAccountsModule } from './loanAccounts/loanAccounts.module';
import { RepaymentSchedulesModule } from './repayment-schedules/repayment-schedules.module';
import { ShareLinksModule } from './share-links/share-links.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { PayeesModule } from './payees/payees.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { OrdersModule } from './orders/orders.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CronJobsModule } from './cron/cron.module';
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
    ShareLinksModule,
    AuthModule,
    PayeesModule,
    EventsModule,
    OrdersModule,
    CronJobsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
