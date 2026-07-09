export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: {
    message: string;
    code?: string;
    fieldErrors?: Record<string, string[]>;
  };
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function apiSuccess<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function apiFailure(
  message: string,
  options?: { code?: string; fieldErrors?: Record<string, string[]> },
): ApiFailure {
  return {
    success: false,
    error: { message, code: options?.code, fieldErrors: options?.fieldErrors },
  };
}
