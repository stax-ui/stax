import { Effect, Schema } from "effect";

import { $ } from "@stax-ui/dom";
import { RedirectError } from "@stax-ui/platform/server";
import { Route, Router } from "@stax-ui/router";

import { AppLayout } from "./components/AppLayout.js";
import { FeedPage } from "./pages/Feed.js";
import { NotFoundPage } from "./pages/NotFound.js";
import { PostDetailPage } from "./pages/PostDetail.js";
import { UserProfilePage } from "./pages/UserProfile.js";
import {
  NotFoundError,
  PostService,
  type Post,
  type User,
} from "./services/PostService.js";

// =============================================================================
// Feed — lists all posts
// =============================================================================

export const FeedRoute = Route.make("/").pipe(
  Route.get(
    ({}) =>
      Effect.gen(function* () {
        const svc = yield* PostService;
        const posts = yield* svc.getPosts();
        const users = yield* svc.getUsers();
        return { posts, users } as {
          posts: readonly Post[];
          users: readonly User[];
        };
      }),
    (data) => FeedPage(data),
  ),
  Route.post("create", (body) =>
    Effect.gen(function* () {
      const { content } = body as { content: string };
      const svc = yield* PostService;
      // Hardcode author to alice for demo simplicity
      const post = yield* svc.createPost("alice", content);
      return post;
    }),
  ),
);

// =============================================================================
// Post detail — single post view
// =============================================================================

export const PostRoute = Route.make("/posts/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.String })),
  Route.get(
    ({ params: { id } }) =>
      Effect.gen(function* () {
        const svc = yield* PostService;
        const post = yield* svc.getPost(id);
        const author = yield* svc.getUser(post.authorId);
        return { post, author } as { post: Post; author: User };
      }).pipe(
        // NotFoundError from the loader → render the 404 page instead of a 500
        Effect.catchTag("NotFoundError", () =>
          Effect.succeed(null as unknown as { post: Post; author: User }),
        ),
      ),
    (data) => (data ? PostDetailPage(data) : NotFoundPage()),
  ),
);

// =============================================================================
// User profile — user info + their posts
// =============================================================================

export const UserRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.String })),
  Route.get(
    ({ params: { id } }) =>
      Effect.gen(function* () {
        const svc = yield* PostService;
        const user = yield* svc.getUser(id);
        const posts = yield* svc.getPostsByUser(id);
        return { user, posts } as {
          user: User;
          posts: readonly Post[];
        };
      }).pipe(
        Effect.catchTag("NotFoundError", () =>
          Effect.succeed(
            null as unknown as { user: User; posts: readonly Post[] },
          ),
        ),
      ),
    (data) => (data ? UserProfilePage(data) : NotFoundPage()),
  ),
);

// =============================================================================
// Redirect: /users/me → /users/alice (demonstrates RedirectError in loaders)
// =============================================================================

export const MeRoute = Route.make("/users/me").pipe(
  Route.get(
    () => Effect.fail(new RedirectError({ url: "/users/alice", status: 302 })),
    () => $.div(), // never reached — loader always redirects
  ),
);

// =============================================================================
// Router
// =============================================================================

export const router = Router.empty.pipe(
  Router.concat(FeedRoute),
  Router.concat(PostRoute),
  Router.concat(MeRoute),
  Router.concat(UserRoute),
  Router.layout(AppLayout),
  Router.fallback(() => NotFoundPage()),
  Router.catchAll(() => $.div({}, $.of("Something went wrong"))),
);
