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
import { PayeesModule } from './payees/payees.module';
@Module({
  imports: [
    PrismaModule,
    UsersModule,
    AdminsModule,
    LoanAccountsModule,
    RepaymentSchedulesModule,
    ShareLinksModule,
    AuthModule,
    PayeesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
