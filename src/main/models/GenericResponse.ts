export interface GenericResponse<T> {
  success: boolean;
  value: T | null;
  error?: string | null;
  errorId?: string | null;
  message?: string | null;
  status?: number;
  url?: string;
  method?: string;
}
