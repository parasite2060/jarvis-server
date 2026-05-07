import { Controller, Get, Param, Query } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { GetAuditLogUseCase } from './usecases/get-audit-log.usecase';
import { ListAuditLogsUseCase } from './usecases/list-audit-logs.usecase';
import { HandleDomainEventUseCase } from './usecases/handle-domain-event.usecase';
import { ListAuditLogsRequest } from './models/requests/list-audit-logs.request';
import { DomainEventDto } from './models/requests/domain-event.dto';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { RpcApiResponse } from 'src/utils/api-rpc.response';
import { AuditLogPresenter } from './models/presenters/audit-log.presenter';
import { PaginatedAuditLogsPresenter } from './models/presenters/paginated-audit-logs.presenter';

@Controller('audit-logs')
export class AuditLogController {
  constructor(
    private readonly getAuditLogUseCase: GetAuditLogUseCase,
    private readonly listAuditLogsUseCase: ListAuditLogsUseCase,
    private readonly handleDomainEventUseCase: HandleDomainEventUseCase,
  ) {}

  @Get(':id')
  async getById(@Param('id') id: string): Promise<HttpApiResponse<AuditLogPresenter>> {
    const presenter = await this.getAuditLogUseCase.execute(id);
    return HttpApiResponse.success(presenter);
  }

  @Get()
  async list(
    @Query()
    request: ListAuditLogsRequest,
  ): Promise<HttpApiResponse<PaginatedAuditLogsPresenter>> {
    const presenter = await this.listAuditLogsUseCase.execute(request);
    return HttpApiResponse.success(presenter);
  }

  @EventPattern(`org-${process.env['RUNTIME_ENV']}-domain-event`)
  async handleDomainEvent(@Payload() event: DomainEventDto): Promise<RpcApiResponse<void>> {
    await this.handleDomainEventUseCase.execute(event);
    return RpcApiResponse.success();
  }
}
