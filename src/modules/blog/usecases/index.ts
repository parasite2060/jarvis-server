import { CreateBlogUseCase } from './create-blog.usecase';
import { GetBlogUseCase } from './get-blog.usecase';
import { ListBlogsUseCase } from './list-blogs.usecase';
import { UpdateBlogUseCase } from './update-blog.usecase';
import { DeleteBlogUseCase } from './delete-blog.usecase';

export const UseCases = [CreateBlogUseCase, GetBlogUseCase, ListBlogsUseCase, UpdateBlogUseCase, DeleteBlogUseCase];
