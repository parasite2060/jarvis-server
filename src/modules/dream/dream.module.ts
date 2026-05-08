import { Module } from '@nestjs/common';

/**
 * DreamModule — owns dream pipelines (light/deep/weekly).
 *
 * Story 13.9 created the empty module + the dreamCoordinatorWorkflow source
 * file. Stories 13.10/13.11/13.12 will add activities + child workflows.
 * Story 13.14 adds the dream controller (POST /dream).
 */
@Module({})
export class DreamModule {}
