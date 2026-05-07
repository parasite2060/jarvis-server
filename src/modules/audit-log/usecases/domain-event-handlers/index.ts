export * from './constants';
export * from './domain-event-handler.decorator';
export * from './domain-event-handler.explorer';
export * from './domain-event-handler.factory';
export * from './domain-event-handler.interface';
export * from './domain-event-transform.decorator';

export * from './blog';
export * from './comment';

import { BlogCreatedHandler } from './blog/blog-created.handler';
import { BlogUpdatedHandler } from './blog/blog-updated.handler';
import { BlogDeletedHandler } from './blog/blog-deleted.handler';
import { CommentCreatedHandler } from './comment/comment-created.handler';
import { CommentDeletedHandler } from './comment/comment-deleted.handler';

export const DomainEventHandlers = [BlogCreatedHandler, BlogUpdatedHandler, BlogDeletedHandler, CommentCreatedHandler, CommentDeletedHandler];
