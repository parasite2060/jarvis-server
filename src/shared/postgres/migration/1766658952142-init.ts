import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1766658952142 implements MigrationInterface {
  name = 'Init1766658952142';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "content" text NOT NULL, "blog_id" uuid NOT NULL, "author_id" character varying(100) NOT NULL, "is_valid" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_comments_blog_id" ON "comments" ("blog_id") `);
    await queryRunner.query(`CREATE INDEX "idx_comments_author_id" ON "comments" ("author_id") `);
    await queryRunner.query(`CREATE INDEX "idx_comments_is_valid" ON "comments" ("is_valid") `);
    await queryRunner.query(
      `CREATE TABLE "blogs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(200) NOT NULL, "content" text NOT NULL, "author_id" character varying(100) NOT NULL, "is_valid" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e113335f11c926da929a625f118" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_blogs_author_id" ON "blogs" ("author_id") `);
    await queryRunner.query(`CREATE INDEX "idx_blogs_is_valid" ON "blogs" ("is_valid") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_blogs_is_valid"`);
    await queryRunner.query(`DROP INDEX "public"."idx_blogs_author_id"`);
    await queryRunner.query(`DROP TABLE "blogs"`);
    await queryRunner.query(`DROP INDEX "public"."idx_comments_is_valid"`);
    await queryRunner.query(`DROP INDEX "public"."idx_comments_author_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_comments_blog_id"`);
    await queryRunner.query(`DROP TABLE "comments"`);
  }
}
