import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatService } from '../chat/chat.service';

@Module({
  imports: [PrismaModule],
  controllers: [EventsController],
  providers: [EventsService, EventsGateway, ChatService],
  exports: [EventsService],
})
export class EventsModule {}
