import { SetMetadata } from '@nestjs/common';
import { ManagementRoles } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ManagementRoles[]) =>
  SetMetadata(ROLES_KEY, roles);
