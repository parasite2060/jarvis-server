class JarvisError(Exception):
    """Base exception for all Jarvis server errors."""

    def __init__(self, message: str, code: str = "JARVIS_ERROR") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class NotFoundError(JarvisError):
    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message, code="NOT_FOUND")


class ValidationError(JarvisError):
    def __init__(self, message: str = "Validation failed") -> None:
        super().__init__(message, code="VALIDATION_ERROR")


class DreamError(JarvisError):
    def __init__(self, message: str = "Dream processing failed") -> None:
        super().__init__(message, code="DREAM_FAILED")


class GitOpsError(JarvisError):
    def __init__(self, message: str = "Git operation failed") -> None:
        super().__init__(message, code="GIT_OPS_FAILED")


class MemuError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class MemuUnavailableError(Exception):
    def __init__(self, detail: str = "MemU server is unreachable") -> None:
        super().__init__(detail)
        self.detail = detail
