export interface OperationLogResponse {
  id: number;
  entity_type: string;
  entity_id: string;
  operation_type: string;
  admin_id: number;
  admin_username: string;
  old_data: string | null;
  new_data: string | null;
  ip_address: string | null;
  created_at: Date;
}

export interface PaginatedOperationLogsResponse {
  data: OperationLogResponse[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
