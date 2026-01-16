import { PartialType } from '@nestjs/mapped-types';
import { CreateEmailConfigDto } from './create-email-config.dto';

export class UpdateEmailConfigDto extends PartialType(CreateEmailConfigDto) {}
