import type { HttpClient } from "./http.js";

/** R1 stub — member/registration reads. Routes land when the first consumer exists (R3+). */
export class UsersApi {
  readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }
}
