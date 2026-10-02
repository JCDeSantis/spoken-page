import { it, expect } from "vitest";
import { progressSaveFailure, progressRetryDelay } from "../progress-save-feedback";
it("stops automatic retries for authentication failures", () => {
  expect(progressSaveFailure(401)).toMatchObject({retryable:false});
  expect(progressSaveFailure(403)).toMatchObject({retryable:false});
  expect(progressSaveFailure(503)).toMatchObject({retryable:true});
  expect(progressSaveFailure().message).toContain("keep it open");
});
it("backs off and caps the retry delay", () => {
  expect([1,2,3,4,50].map(progressRetryDelay)).toEqual([10000,20000,40000,60000,60000]);
});
