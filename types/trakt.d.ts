declare module 'trakt.tv' {
  export interface TraktOptions {
    client_id: string;
    client_secret: string;
    redirect_uri?: string;
    api_url?: string;
    useragent?: string;
    pagination?: boolean;
  }
  export interface TraktDeviceCode {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  }
  export interface TraktAccess {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
    created_at: number;
  }
  export interface TraktAccessExport {
    access_token: string;
    expires: number;
    refresh_token: string;
  }

  export type TraktType = 'movie' | 'show' | 'season' | 'episode' | 'person';
  export type TraktSearchType = 'movie' | 'show' | 'episode' | 'person' | 'list';
  export type TraktSearchIDType = 'trakt' | 'imdb' | 'tmdb' | 'tvdb';
  export type TraktSearchFields = 'title' | 'tagline' | 'overview' | 'people' | 'translations' | 'aliases' | 'name' | 'biography' | 'description';

  export interface TraktIds {
    slug?: string;
    trakt?: number;
    imdb?: string | null;
    tmdb?: number | null;
    tvdb?: number | null;
  }
  export interface TraktList {
    name: string;
    description: string;
    privacy: string;
    share_link: string;
    type: string;
    display_numbers: boolean;
    allow_comments: boolean;
    sort_by: string;
    sort_how: string;
    created_at: string;
    updated_at: string;
    item_count: number;
    comment_count: number;
    likes: number;
    ids: TraktIds
    user?: TraktUser;
  }
  export interface TraktUser {
    username: string,
    private: boolean;
    name: string;
    vip: boolean;
    vip_ep: boolean;
    ids: TraktIds
  }
  export interface TraktReorderResponse {
    updated: number;
    skipped_ids: number[];
    list?: {
      updated_at: string;
      item_count: number;
    }
  }
  export interface TraktUsersListItemsAddResponse {
    added: {
      movies: number;
      shows: number;
      seasons: number;
      episodes: number;
      people: number;
    };
    existing: {
      movies: number;
      shows: number;
      seasons: number;
      episodes: number;
      people: number;
    };
    not_found: {
      movies: TraktIds[];
      shows: TraktIds[];
      seasons: TraktIds[];
      episodes: TraktIds[];
      people: TraktIds[];
    };
    list: {
      updated_at: string;
      item_count: number;
    }
  }
  export interface TraktUsersListItemsRemoveResponse {
    deleted: {
      movies: number;
      shows: number;
      seasons: number;
      episodes: number;
      people: number;
    };
    not_found: {
      movies: TraktIds[];
      shows: TraktIds[];
      seasons: TraktIds[];
      episodes: TraktIds[];
      people: TraktIds[];
    };
    list: {
      updated_at: string;
      item_count: number;
    }
  }
  export interface TraktLike {
    liked_at: string;
    user: TraktUser;
  }
  export interface TraktMovie {
    title: string;
    year: number;
    ids: TraktIds;
  }
  export interface TraktShow {
    title: string;
    year: number;
    ids: TraktIds;
  }
  export interface TraktShowSeason {
    number: number;
    ids: TraktIds;
  }
  export interface TraktShowEpisode {
    season: number;
    number: number;
    title: string;
    ids: TraktIds;
  }
  export interface TraktPerson {
    name: string;
    ids: TraktIds;
  }
  export interface TraktItem {
    rank: number;
    id: number;
    listed_at: string;
    notes: string;
    type: TraktType;
    movie?: TraktMovie;
    show?: TraktShow;
    season?: TraktShowSeason;
    episode?: TraktShowEpisode;
    person?: TraktPerson;
  }

  export type TraktPrivacy = 'private' | 'link' | 'friends' | 'public';
  interface BaseRequest {
    username: string;
  }
  interface UsersListsCreateRequest extends BaseRequest {
    name: string;
    description?: string;
    privacy?: TraktPrivacy;
    display_numbers?: boolean;
    allow_comments?: boolean;
  }
  interface UsersListsReorderRequest extends BaseRequest {
    rank: number[];
  }
  interface UsersListRequest extends BaseRequest {
    id: string;
  }
  interface UsersListUpdateRequest extends UsersListRequest {
    name?: string;
    description?: string;
    privacy?: TraktPrivacy;
    display_numbers?: boolean;
    allow_comments?: boolean;
  }
  interface UsersListItemsGet extends UsersListRequest {
    type? : TraktType;
  }
  export interface UsersListItemsAddRemove extends UsersListRequest {
    movies: { ids: TraktIds, notes?: string }[];
    shows: {
      ids: TraktIds;
      notes?: string;
      seasons?: {
        number: number;
        episodes?: { number: number }[];
        ids: TraktIds;
      }[];
    }[];
    seasons: {
      ids: TraktIds;
    }[];
    episodes: { ids: TraktIds }[];
    people: {
      name: string;
      ids: TraktIds;
    }[];
  }
  interface UsersListItemsReorderRequest extends UsersListRequest {
    rank: number[];
  }

  export interface TraktSearchItem {
    type: TraktSearchType;
    score: number;
    movie?: TraktMovie;
    show?: TraktShow;
    episode?: TraktShowEpisode;
    person?: TraktPerson;
    list?: TraktList;
  }

  interface Users {
    lists: {
      get(body: BaseRequest): Promise<TraktList[]>;
      collaborations(body: BaseRequest): Promise<TraktList[]>;
      create(body: UsersListsCreateRequest): Promise<TraktList>;
      reorder(body: UsersListsReorderRequest): Promise<TraktReorderResponse>;
    };
    list: {
      get(body: UsersListRequest): Promise<TraktList>;
      update(body: UsersListUpdateRequest): Promise<TraktList>;
      delete(body: UsersListRequest): Promise<void>;
      likes(body: UsersListRequest): Promise<TraktLike[]>;
      like: {
        add(body: UsersListRequest): Promise<void>;
        remove(body: UsersListRequest): Promise<void>;
      };
      items: {
        get(body: UsersListItemsGet): Promise<TraktItem[]>;
        add(body: UsersListItemsAddRemove): Promise<TraktUsersListItemsAddResponse>;
        remove(body: UsersListItemsAddRemove): Promise<TraktUsersListItemsRemoveResponse>;
        reorder(body: UsersListItemsReorderRequest): Promise<TraktReorderResponse>;
      };
      comments();
    };
    follow: {
      add();
      remove();
    };
    followers();
    following();
    friends();
    history();
    ratings();
    watchlist();
    recommendations();
    watching();
    watched();
    stats();
  }

  interface SearchRequest {
    type: TraktSearchType;
    query: string;
    fields?: TraktSearchFields;
  }

  interface SearchIDRequest {
    id_type: TraktSearchIDType;
    id: string;
    type?: TraktSearchType;
    fields?: TraktSearchFields;
  }

  interface Search {
    text(request: SearchRequest): Promise<TraktSearchItem[]>;
    id(request: SearchIDRequest): Promise<TraktSearchItem[]>;
  }

  class Trakt {
    users: Users;

    search: Search;

    constructor(settings: TraktOptions, debug?: boolean = false);
    get_url(): string;
    exchange_code(code: string, state?: unknown): Promise<TraktAccess>;
    get_codes(): Promise<TraktDeviceCode>;
    poll_access(poll: TraktDeviceCode): Promise<TraktAccess>;
    refresh_token(): Promise<TraktAccess>;
    import_token(token: TraktAccessExport): Promise<TraktAccessExport>;
    export_token(): TraktAccessExport;
    revoke_token(): void;
  }

  declare const Trakt: Trakt;
  export default Trakt;
}
