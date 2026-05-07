import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CreateBlogUseCase } from './usecases/create-blog.usecase';
import { GetBlogUseCase } from './usecases/get-blog.usecase';
import { ListBlogsUseCase } from './usecases/list-blogs.usecase';
import { UpdateBlogUseCase } from './usecases/update-blog.usecase';
import { DeleteBlogUseCase } from './usecases/delete-blog.usecase';
import { CreateBlogRequest } from './models/requests/create-blog.request';
import { UpdateBlogRequest } from './models/requests/update-blog.request';
import { ListBlogsRequest } from './models/requests/list-blogs.request';
import { HttpApiResponse } from 'src/utils/api-http.response';
import { CreateBlogResponse } from './models/responses/create-blog.response';
import { BlogPresenter } from './models/presenters/blog.presenter';
import { PaginatedBlogsPresenter } from './models/presenters/paginated-blogs.presenter';
import { UpdateBlogResponse } from './models/responses/update-blog.response';

@Controller('blogs')
export class BlogController {
  constructor(
    private readonly createBlogUseCase: CreateBlogUseCase,
    private readonly getBlogUseCase: GetBlogUseCase,
    private readonly listBlogsUseCase: ListBlogsUseCase,
    private readonly updateBlogUseCase: UpdateBlogUseCase,
    private readonly deleteBlogUseCase: DeleteBlogUseCase,
  ) {}

  @Post()
  async create(
    @Body()
    request: CreateBlogRequest,
  ): Promise<HttpApiResponse<CreateBlogResponse>> {
    const response = await this.createBlogUseCase.execute(request);
    return HttpApiResponse.success(response);
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<HttpApiResponse<BlogPresenter>> {
    const presenter = await this.getBlogUseCase.execute(id);
    return HttpApiResponse.success(presenter);
  }

  @Get()
  async list(
    @Query()
    request: ListBlogsRequest,
  ): Promise<HttpApiResponse<PaginatedBlogsPresenter>> {
    const presenter = await this.listBlogsUseCase.execute(request);
    return HttpApiResponse.success(presenter);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    request: UpdateBlogRequest,
  ): Promise<HttpApiResponse<UpdateBlogResponse>> {
    const response = await this.updateBlogUseCase.execute(id, request);
    return HttpApiResponse.success(response);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<HttpApiResponse<void>> {
    await this.deleteBlogUseCase.execute(id);
    return HttpApiResponse.success();
  }
}
