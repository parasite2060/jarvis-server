import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CreateCommentUseCase } from './usecases/create-comment.usecase';
import { GetCommentUseCase } from './usecases/get-comment.usecase';
import { ListCommentsUseCase } from './usecases/list-comments.usecase';
import { DeleteCommentUseCase } from './usecases/delete-comment.usecase';
import { CreateCommentRequest } from './models/requests/create-comment.request';
import { ListCommentsRequest } from './models/requests/list-comments.request';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { CreateCommentResponse } from './models/responses/create-comment.response';
import { CommentPresenter } from './models/presenters/comment.presenter';
import { PaginatedCommentsPresenter } from './models/presenters/paginated-comments.presenter';

@Controller('comments')
export class CommentController {
  constructor(
    private readonly createCommentUseCase: CreateCommentUseCase,
    private readonly getCommentUseCase: GetCommentUseCase,
    private readonly listCommentsUseCase: ListCommentsUseCase,
    private readonly deleteCommentUseCase: DeleteCommentUseCase,
  ) {}

  @Post()
  async create(
    @Body()
    request: CreateCommentRequest,
  ): Promise<HttpApiResponse<CreateCommentResponse>> {
    const response = await this.createCommentUseCase.execute(request);
    return HttpApiResponse.success(response);
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<HttpApiResponse<CommentPresenter>> {
    const presenter = await this.getCommentUseCase.execute(id);
    return HttpApiResponse.success(presenter);
  }

  @Get()
  async list(
    @Query()
    request: ListCommentsRequest,
  ): Promise<HttpApiResponse<PaginatedCommentsPresenter>> {
    const presenter = await this.listCommentsUseCase.execute(request);
    return HttpApiResponse.success(presenter);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<HttpApiResponse<void>> {
    await this.deleteCommentUseCase.execute(id);
    return HttpApiResponse.success();
  }
}
