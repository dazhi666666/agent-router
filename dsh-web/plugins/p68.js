window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-file-upload",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		//#region ../../util/crypto/lib/index.js
		/**
		* UUID minting that works in every JavaScript context this repository ships
		* to. `crypto.randomUUID` is a secure-context Web API — a page or worker
		* served over plain HTTP on a LAN address has no such method — while
		* `crypto.getRandomValues` is unrestricted everywhere (browsers, workers,
		* Node ≥ 19). One implementation here replaces per-caller polyfills; the
		* `no-restricted-properties` lint rule points `crypto.randomUUID` callers at
		* this module.
		* @module @deepseek-ai/dsh-util-crypto
		*/
		/**
		* Encode bytes as canonical base64 without overflowing function argument limits.
		* @param data - Bytes to encode.
		* @returns base64 text.
		*/
		function bytesToBase64(data) {
			let binary = "";
			const chunk = 32768;
			for (let offset = 0; offset < data.length; offset += chunk) binary += String.fromCharCode(...data.subarray(offset, offset + chunk));
			return btoa(binary);
		}
		//#endregion
		//#region ../../typert/protocol/lib/index.js
		/** The one Remote failure class shared by owners, the Gateway, and consumers. */
		/**
		* One Remote call failure: a real Error carrying its stable code and typed
		* details. Owners throw it at the failure point; the Host Gateway encodes it
		* onto the wire unchanged; the Client face rebuilds an instance for the
		* `RemoteResult` error branch, so `throw result.error` keeps throw semantics.
		* Discrimination is always by `code`, never by instanceof.
		*/
		var RemoteError = class extends Error {
			code;
			details;
			/** Structural marker: cross-realm/bundle identification never uses instanceof. */
			isDSHRemoteError = true;
			/**
			* @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
			* @param message - human diagnostic carried across the wire.
			* @param details - structured payload typed by the code.
			* @param options - standard Error options (`cause` survives in-process only).
			*/
			constructor(code, message, details, options) {
				super(message, options);
				this.code = code;
				this.details = details;
				this.name = "RemoteError";
			}
		};
		/**
		* Browser-relative form of {@link FILE_UPLOAD_PATH}; see
		* .agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md.
		*/
		const FILE_UPLOAD_ROUTE = "/api/session/uploadFileBinary".slice(1);
		//#endregion
		//#region lib/types/client/runtime.js
		/** Background browser upload implementation for Blob and byte-stream bodies. */
		/**
		* Self-contained Worker body; its string form becomes the Blob Worker source.
		* @param scope - Worker global used for requests and progress messages.
		* @param createXhr - XMLHttpRequest factory used for Blob progress.
		* @param doFetch - Fetch carrier used for one-shot ReadableStream bodies.
		*/
		function fileUploadWorker(scope = self, createXhr = () => new XMLHttpRequest(), doFetch = (input, init) => fetch(input, init)) {
			scope.onmessage = (event) => {
				const request = event.data;
				if (request.body instanceof Blob) {
					const xhr = createXhr();
					xhr.open("POST", request.url);
					xhr.withCredentials = true;
					for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
					xhr.upload.onprogress = (progress) => {
						scope.postMessage({
							kind: "progress",
							loaded: progress.loaded,
							...progress.lengthComputable ? { total: progress.total } : {}
						});
					};
					xhr.onload = () => {
						scope.postMessage({
							kind: "complete",
							status: xhr.status,
							body: xhr.responseText
						});
					};
					xhr.onerror = () => {
						scope.postMessage({
							kind: "error",
							message: "background upload transport failed"
						});
					};
					xhr.send(request.body);
					return;
				}
				if (!(request.body instanceof ReadableStream)) {
					scope.postMessage({
						kind: "error",
						message: "background upload worker received an invalid body"
					});
					return;
				}
				const source = request.body;
				(async () => {
					const reader = source.getReader();
					let loaded = 0;
					const body = new ReadableStream({
						async pull(controller) {
							const item = await reader.read();
							if (item.done) {
								controller.close();
								return;
							}
							if (!(item.value instanceof Uint8Array)) throw new TypeError("background upload stream produced a non-Uint8Array chunk");
							loaded += item.value.byteLength;
							scope.postMessage({
								kind: "progress",
								loaded
							});
							controller.enqueue(item.value);
						},
						async cancel(reason) {
							await reader.cancel(reason);
						}
					});
					const response = await doFetch(request.url, {
						method: "POST",
						headers: request.headers,
						credentials: "include",
						body,
						duplex: "half"
					});
					scope.postMessage({
						kind: "complete",
						status: response.status,
						body: await response.text()
					});
				})().catch((error) => {
					scope.postMessage({
						kind: "error",
						message: error instanceof Error ? error.message : String(error)
					});
				});
			};
		}
		/** Cordis service that owns one background carrier per upload operation. */
		var FileUploadRuntime = class extends _deepseek_ai_cordis.Service {
			transport;
			/** @param ctx - providing Client context. */
			constructor(ctx) {
				super(ctx, "fileUpload");
				const hook = globalThis.__DSH_FILE_UPLOAD__;
				this.transport = hook === void 0 ? workerTransport() : customTransport(hook.fetch);
			}
			/**
			* Post one body with the carrier selected before Cordis boot.
			* @param request - target, body, cancellation, and progress observer.
			* @returns the response status and text body.
			*/
			post(request) {
				return this.transport.post(request);
			}
			/**
			* Store one file for a Session.
			* @param sessionId - Session that owns the staged receipt.
			* @param data - browser Blob, exact bytes, or a one-shot byte stream.
			* @param name - optional display name.
			* @param signal - optional cancellation for the active upload.
			* @param onProgress - optional byte-progress observer for background bodies.
			* @returns the staged receipt and durable file reference, or a business error.
			*/
			async upload(sessionId, data, name, signal, onProgress) {
				if (!(data instanceof Uint8Array)) {
					const query = new URLSearchParams({ sessionId });
					if (name !== void 0) query.set("name", name);
					const response = await this.post({
						path: `${FILE_UPLOAD_ROUTE}?${query.toString()}`,
						body: data,
						headers: { "content-type": "application/octet-stream" },
						...signal === void 0 ? {} : { signal },
						...onProgress === void 0 ? {} : { onProgress }
					});
					if (response.status !== 200) throw new Error(`file upload transport failed with HTTP ${String(response.status)}`);
					return parseFileUploadResult(response.body);
				}
				return this.ctx.remote.fileUploads.upload(sessionId, {
					data: bytesToBase64(data),
					...name === void 0 ? {} : { name }
				}, signal);
			}
		};
		function customTransport(customFetch) {
			return { async post(request) {
				const init = {
					method: "POST",
					...request.headers === void 0 ? {} : { headers: request.headers },
					body: request.body,
					...request.body instanceof ReadableStream ? { duplex: "half" } : {},
					...request.signal === void 0 ? {} : { signal: request.signal }
				};
				const response = await customFetch(request.path, init);
				return {
					status: response.status,
					body: await response.text()
				};
			} };
		}
		function workerTransport() {
			return { post(request) {
				if (typeof Worker !== "function") return Promise.reject(/* @__PURE__ */ new Error("background upload requires Web Worker support"));
				const workerUrl = URL.createObjectURL(new Blob([`(${fileUploadWorker.toString()})()`], { type: "text/javascript" }));
				const worker = new Worker(workerUrl, { name: "dsh-file-upload" });
				URL.revokeObjectURL(workerUrl);
				return new Promise((resolve, reject) => {
					let settled = false;
					const abort = () => {
						settled = true;
						worker.terminate();
						request.signal?.removeEventListener("abort", abort);
						reject(new DOMException("The operation was aborted.", "AbortError"));
					};
					const finish = (settle) => {
						if (settled) return;
						settled = true;
						request.signal?.removeEventListener("abort", abort);
						worker.terminate();
						settle();
					};
					worker.onmessage = (event) => {
						const output = event.data;
						if (output.kind === "progress") request.onProgress?.({
							loaded: output.loaded,
							...output.total === void 0 ? {} : { total: output.total }
						});
						else if (output.kind === "complete") finish(() => {
							resolve({
								status: output.status,
								body: output.body
							});
						});
						else finish(() => {
							reject(new Error(output.message));
						});
					};
					worker.onerror = (event) => {
						finish(() => {
							reject(new Error(event.message || "background upload worker failed"));
						});
					};
					if (request.signal?.aborted === true) {
						abort();
						return;
					}
					request.signal?.addEventListener("abort", abort, { once: true });
					const message = {
						url: new URL(request.path, document.baseURI).href,
						body: request.body,
						headers: request.headers ?? {}
					};
					if (request.body instanceof ReadableStream) worker.postMessage(message, [request.body]);
					else worker.postMessage(message);
				});
			} };
		}
		function parseFileUploadResult(body) {
			const value = JSON.parse(body);
			if (!isRecord(value) || typeof value.ok !== "boolean") throw new TypeError("file upload transport returned an invalid result");
			if (!value.ok) {
				const error = value.error;
				if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string" || !isRecord(error.details)) throw new TypeError("file upload transport returned an invalid failure");
				return {
					ok: false,
					error: new RemoteError(error.code, error.message, error.details)
				};
			}
			const result = value.value;
			const file = isRecord(result) ? result.file : void 0;
			if (!isRecord(result) || typeof result.receiptId !== "string" || !isRecord(file) || typeof file.attachmentId !== "string" || typeof file.name !== "string" || typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new TypeError("file upload transport returned an invalid receipt");
			return {
				ok: true,
				value: {
					receiptId: result.receiptId,
					file: {
						attachmentId: file.attachmentId,
						name: file.name,
						bytes: file.bytes
					}
				}
			};
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Browser background-upload Cordis service. */
		/** The upload service uses the generated Remote fallback. */
		const inject = ["remote"];
		/**
		* Provide the browser background-upload service.
		* @param ctx - Client plugin context.
		*/
		function apply(ctx) {
			ctx.plugin(FileUploadRuntime);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-api-remotes",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
		var _a$1;
		function $constructor(name, initializer, params) {
			function init(inst, def) {
				if (!inst._zod) Object.defineProperty(inst, "_zod", {
					value: {
						def,
						constr: _,
						traits: /* @__PURE__ */ new Set()
					},
					enumerable: false
				});
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				const proto = _.prototype;
				const keys = Object.keys(proto);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				var _a;
				const inst = params?.Parent ? new Definition() : this;
				init(inst, def);
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				for (const fn of inst._zod.deferred) fn();
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		function cached(getter) {
			return { get value() {
				{
					const value = getter();
					Object.defineProperty(this, "value", { value });
					return value;
				}
				throw new Error("cached value already set");
			} };
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
		function defineLazy(object, key, getter) {
			let value = void 0;
			Object.defineProperty(object, key, {
				get() {
					if (value === EVALUATING) return;
					if (value === void 0) {
						value = EVALUATING;
						value = getter();
					}
					return value;
				},
				set(v) {
					Object.defineProperty(object, key, { value: v });
				},
				configurable: true
			});
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) Object.assign(mergedDescriptors, Object.getOwnPropertyDescriptors(def));
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = {
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = {};
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						newShape[key] = currDef.shape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = { ...schema._zod.def.shape };
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						delete newShape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = schema._zod.def.shape;
				for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function merge(a, b) {
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			return clone(a, mergeDefs(a._zod.def, {
				get shape() {
					const _shape = {
						...a._zod.def.shape,
						...b._zod.def.shape
					};
					assignProp(this, "shape", _shape);
					return _shape;
				},
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask) {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const oldShape = schema._zod.def.shape;
					const shape = { ...oldShape };
					if (mask) for (const key in mask) {
						if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						shape[key] = Class ? new Class({
							type: "optional",
							innerType: oldShape[key]
						}) : oldShape[key];
					}
					else for (const key in oldShape) shape[key] = Class ? new Class({
						type: "optional",
						innerType: oldShape[key]
					}) : oldShape[key];
					assignProp(this, "shape", shape);
					return shape;
				},
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const oldShape = schema._zod.def.shape;
				const shape = { ...oldShape };
				if (mask) for (const key in mask) {
					if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					shape[key] = new Class({
						type: "nonoptional",
						innerType: oldShape[key]
					});
				}
				else for (const key in oldShape) shape[key] = new Class({
					type: "nonoptional",
					innerType: oldShape[key]
				});
				assignProp(this, "shape", shape);
				return shape;
			} }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function finalizeIssue(iss, ctx, config) {
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
			rest.path ?? (rest.path = []);
			rest.message = message;
			if (ctx?.reportInput) rest.input = _input;
			return rest;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			Object.defineProperty(inst, "_zod", {
				value: inst._zod,
				enumerable: false
			});
			Object.defineProperty(inst, "issues", {
				value: def,
				enumerable: false
			});
			inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
			Object.defineProperty(inst, "toString", {
				value: () => inst.message,
				enumerable: false
			});
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) {
				fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
				fieldErrors[sub.path[0]].push(mapper(sub));
			} else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
							else {
								curr[el] = curr[el] || { _errors: [] };
								curr[el]._errors.push(mapper(issue));
							}
							curr = curr[el];
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
		const _parse = (_Err) => (schema, value, _ctx, _params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			if (result.issues.length) {
				const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, _params?.callee);
				throw e;
			}
			return result.value;
		};
		const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			if (result.issues.length) {
				const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, params?.callee);
				throw e;
			}
			return result.value;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? {
				success: false,
				error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? {
				success: false,
				error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
		const _encode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parse(_Err)(schema, value, ctx);
		};
		const _decode = (_Err) => (schema, value, _ctx) => {
			return _parse(_Err)(schema, value, _ctx);
		};
		const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parseAsync(_Err)(schema, value, ctx);
		};
		const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _parseAsync(_Err)(schema, value, _ctx);
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^[A-Za-z0-9_-]*$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time$1(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime$1(args) {
			const time = timeSource({ precision: args.precision });
			const opts = ["Z"];
			if (args.local) opts.push("");
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const timeRegex = `${time}(?:${opts.join("|")})`;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const string$1 = (params) => {
			const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
			return new RegExp(`^${regex}$`);
		};
		const integer = /^-?\d+$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const boolean$1 = /^(?:true|false)$/i;
		const _undefined$2 = /^undefined$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
				if (def.value < curr) if (def.inclusive) bag.maximum = def.value;
				else bag.exclusiveMaximum = def.value;
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
				if (def.value > curr) if (def.inclusive) bag.minimum = def.value;
				else bag.exclusiveMinimum = def.value;
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				var _a;
				(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
			});
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				bag.minimum = minimum;
				bag.maximum = maximum;
				if (isInt) bag.pattern = integer;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
				if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
				if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.minimum = def.length;
				bag.maximum = def.length;
				bag.length = def.length;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				const length = input.length;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				if (def.pattern) {
					bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
					bag.patterns.add(def.pattern);
				}
			});
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
			def.pattern = pattern;
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = []) {
				this.content = [];
				this.indent = 0;
				if (this) this.args = args;
			}
			indented(fn) {
				this.indent += 1;
				fn(this);
				this.indent -= 1;
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const args = this?.args;
				const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
				return new F(...args, lines.join("\n"));
			}
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const checks = [...inst._zod.def.checks ?? []];
			if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
			defineLazy(inst, "~standard", () => ({
				validate: (value) => {
					try {
						const r = safeParse$1(inst, value);
						return r.success ? { value: r.data } : { issues: r.error?.issues };
					} catch (_) {
						return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
					}
				},
				vendor: "zod",
				version: 1
			}));
		});
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					if (!def.normalize && def.protocol?.source === httpProtocol.source) {
						if (!/^https?:\/\//i.test(trimmed)) {
							payload.issues.push({
								code: "invalid_format",
								format: "url",
								note: "Invalid URL format",
								input: payload.value,
								inst,
								continue: !def.abort
							});
							return;
						}
					}
					const url = new URL(trimmed);
					if (def.hostname) {
						def.hostname.lastIndex = 0;
						if (!def.hostname.test(url.hostname)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid hostname",
							pattern: def.hostname.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.protocol) {
						def.protocol.lastIndex = 0;
						if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid protocol",
							pattern: def.protocol.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.normalize) payload.value = url.href;
					else payload.value = trimmed;
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			def.pattern ?? (def.pattern = nanoid);
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv4`;
		});
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv6`;
			inst._zod.check = (payload) => {
				try {
					new URL(`http://[${payload.value}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "ipv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				const parts = payload.value.split("/");
				try {
					if (parts.length !== 2) throw new Error();
					const [address, prefix] = parts;
					if (!prefix) throw new Error();
					const prefixNum = Number(prefix);
					if (`${prefixNum}` !== prefix) throw new Error();
					if (prefixNum < 0 || prefixNum > 128) throw new Error();
					new URL(`http://[${address}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "cidrv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64";
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64URL(data) {
			if (!base64url.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64url);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64url";
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUndefined = /*@__PURE__*/ $constructor("$ZodUndefined", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = _undefined$2;
			inst._zod.values = new Set([void 0]);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (typeof input === "undefined") return payload;
				payload.issues.push({
					expected: "undefined",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodVoid = /*@__PURE__*/ $constructor("$ZodVoid", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (typeof input === "undefined") return payload;
				payload.issues.push({
					expected: "void",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = Array(input.length);
				const proms = [];
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else handleArrayResult(result, payload, i);
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
			const isPresent = key in input;
			if (result.issues.length) {
				if (isOptionalIn && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && !isOptionalIn) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				keys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const isOptionalIn = _catchall.optin === "optional";
			const isOptionalOut = _catchall.optout === "optional";
			for (const key in input) {
				if (key === "__proto__") continue;
				if (keySet.has(key)) continue;
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
				else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
				const sh = def.shape;
				Object.defineProperty(def, "shape", { get: () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					return newSh;
				} });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazy(inst._zod, "propValues", () => {
				const shape = def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
					}
				}
				return propValues;
			});
			const isObject$1 = isObject;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = {};
				const proms = [];
				const shape = value.shape;
				for (const key of value.keys) {
					const el = shape[key];
					const isOptionalIn = el._zod.optin === "optional";
					const isOptionalOut = el._zod.optout === "optional";
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
					else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const generateFastpass = (shape) => {
				const doc = new Doc([
					"shape",
					"payload",
					"ctx"
				]);
				const normalized = _normalized.value;
				const parseStr = (key) => {
					const k = esc(key);
					return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				};
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.keys) ids[key] = `key_${counter++}`;
				doc.write(`const newResult = {};`);
				for (const key of normalized.keys) {
					const id = ids[key];
					const k = esc(key);
					const schema = shape[key];
					const isOptionalIn = schema?._zod?.optin === "optional";
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(key)};`);
					if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
					else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				const fn = doc.compile();
				return (payload, ctx) => fn(shape, payload, ctx);
			};
			let fastpass;
			const isObject$2 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "values", () => {
				if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazy(inst._zod, "pattern", () => {
				if (def.options.every((o) => o._zod.pattern)) {
					const patterns = def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				for (const key of sharedKeys) {
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
				unrecIssue ?? (unrecIssue = iss);
				for (const k of iss.keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k).l = true;
				}
			} else result.issues.push(iss);
			for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).r = true;
			}
			else result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length && unrecIssue) result.issues.push({
				...unrecIssue,
				keys: bothKeys
			});
			if (aborted(result)) return result;
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			result.value = merged.data;
			return result;
		}
		const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!isPlainObject(input)) {
					payload.issues.push({
						expected: "record",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				const proms = [];
				const values = def.keyType._zod.values;
				if (values) {
					payload.value = {};
					const recordKeys = /* @__PURE__ */ new Set();
					for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
						recordKeys.add(typeof key === "number" ? key.toString() : key);
						const keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (keyResult.issues.length) {
							payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const outKey = keyResult.value;
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}
					}
					let unrecognized;
					for (const key in input) if (!recordKeys.has(key)) {
						unrecognized = unrecognized ?? [];
						unrecognized.push(key);
					}
					if (unrecognized && unrecognized.length > 0) payload.issues.push({
						code: "unrecognized_keys",
						input,
						inst,
						keys: unrecognized
					});
				} else {
					payload.value = {};
					for (const key of Reflect.ownKeys(input)) {
						if (key === "__proto__") continue;
						if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
						let keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
							const retryResult = def.keyType._zod.run({
								value: Number(key),
								issues: []
							}, ctx);
							if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
							if (retryResult.issues.length === 0) keyResult = retryResult;
						}
						if (keyResult.issues.length) {
							if (def.mode === "loose") payload.value[key] = input[key];
							else payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[keyResult.value] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[keyResult.value] = result.value;
						}
					}
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
			$ZodType.init(inst, def);
			if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
			const values = new Set(def.values);
			inst._zod.values = values;
			inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (values.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values: def.values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				payload.fallback = true;
				return payload;
			};
		});
		function handleOptionalResult(result, input) {
			if (input === void 0 && (result.issues.length || result.fallback)) return {
				issues: [],
				value: void 0
			};
			return result;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.optout = "optional";
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? new Set([...def.innerType._zod.values, void 0]) : void 0;
			});
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (def.innerType._zod.optin === "optional") {
					const input = payload.value;
					const result = def.innerType._zod.run(payload, ctx);
					if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
					return handleOptionalResult(result, input);
				}
				if (payload.value === void 0) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => {
				const v = def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => {
					payload.value = result.value;
					if (result.issues.length) {
						payload.value = def.catchValue({
							...payload,
							error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
							input: payload.value
						});
						payload.issues = [];
						payload.fallback = true;
					}
					return payload;
				});
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
					payload.fallback = true;
				}
				return payload;
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => def.in._zod.values);
			defineLazy(inst._zod, "optin", () => def.in._zod.optin);
			defineLazy(inst._zod, "optout", () => def.out._zod.optout);
			defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.length) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues,
				fallback: left.fallback
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
			defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodLazy = /*@__PURE__*/ $constructor("$ZodLazy", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "innerType", () => {
				const d = def;
				if (!d._cachedInner) d._cachedInner = def.getter();
				return d._cachedInner;
			});
			defineLazy(inst._zod, "pattern", () => inst._zod.innerType?._zod?.pattern);
			defineLazy(inst._zod, "propValues", () => inst._zod.innerType?._zod?.propValues);
			defineLazy(inst._zod, "optin", () => inst._zod.innerType?._zod?.optin ?? void 0);
			defineLazy(inst._zod, "optout", () => inst._zod.innerType?._zod?.optout ?? void 0);
			inst._zod.parse = (payload, ctx) => {
				return inst._zod.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class({
				type: "string",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class({
				type: "number",
				checks: [],
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _undefined$1(Class, params) {
			return new Class({
				type: "undefined",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _void$1(Class, params) {
			return new Class({
				type: "void",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
			else result.definitions = defs;
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time") delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const regexes = [...patterns];
				if (regexes.length === 1) json.pattern = regexes[0].source;
				else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
			if (typeof format === "string" && format.includes("int")) json.type = "integer";
			else json.type = "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) if (legacy) {
				json.minimum = exclusiveMinimum;
				json.exclusiveMinimum = true;
			} else json.exclusiveMinimum = exclusiveMinimum;
			else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) if (legacy) {
				json.maximum = exclusiveMaximum;
				json.exclusiveMaximum = true;
			} else json.exclusiveMaximum = exclusiveMaximum;
			else if (typeof maximum === "number") json.maximum = maximum;
			if (typeof multipleOf === "number") json.multipleOf = multipleOf;
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const undefinedProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Undefined cannot be represented in JSON Schema");
		};
		const voidProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Void cannot be represented in JSON Schema");
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const literalProcessor = (schema, ctx, json, _params) => {
			const def = schema._zod.def;
			const vals = [];
			for (const val of def.values) if (val === void 0) {
				if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
			} else if (typeof val === "bigint") if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
			else vals.push(Number(val));
			else vals.push(val);
			if (vals.length === 0) {} else if (vals.length === 1) {
				const val = vals[0];
				json.type = val === null ? "null" : typeof val;
				if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
				else json.const = val;
			} else {
				if (vals.every((v) => typeof v === "number")) json.type = "number";
				if (vals.every((v) => typeof v === "string")) json.type = "string";
				if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
				if (vals.every((v) => v === null)) json.type = "null";
				json.enum = vals;
			}
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			json.properties = {};
			const shape = def.shape;
			for (const key in shape) json.properties[key] = process(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			});
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const v = def.shape[key]._zod;
				if (ctx.io === "input") return v.optin === void 0;
				else return v.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const recordProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			const keyType = def.keyType;
			const patterns = keyType._zod.bag?.patterns;
			if (def.mode === "loose" && patterns && patterns.size > 0) {
				const valueSchema = process(def.valueType, ctx, {
					...params,
					path: [
						...params.path,
						"patternProperties",
						"*"
					]
				});
				json.patternProperties = {};
				for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
			} else {
				if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process(def.keyType, ctx, {
					...params,
					path: [...params.path, "propertyNames"]
				});
				json.additionalProperties = process(def.valueType, ctx, {
					...params,
					path: [...params.path, "additionalProperties"]
				});
			}
			const keyValues = keyType._zod.values;
			if (keyValues) {
				const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
				if (validKeyValues.length > 0) json.required = validKeyValues;
			}
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const lazyProcessor = (schema, ctx, _json, params) => {
			const innerType = schema._zod.innerType;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function datetime(params) {
			return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
		}
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function date(params) {
			return /* @__PURE__ */ _isoDate(ZodISODate, params);
		}
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function time(params) {
			return /* @__PURE__ */ _isoTime(ZodISOTime, params);
		}
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function duration(params) {
			return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			Object.defineProperties(inst, {
				format: { value: (mapper) => formatError(inst, mapper) },
				flatten: { value: (mapper) => flattenError(inst, mapper) },
				addIssue: { value: (issue) => {
					inst.issues.push(issue);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				addIssues: { value: (issues) => {
					inst.issues.push(...issues);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				isEmpty: { get() {
					return inst.issues.length === 0;
				} }
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
		const _installedGroups = /* @__PURE__ */ new WeakMap();
		function _installLazyMethods(inst, group, methods) {
			const proto = Object.getPrototypeOf(inst);
			let installed = _installedGroups.get(proto);
			if (!installed) {
				installed = /* @__PURE__ */ new Set();
				_installedGroups.set(proto, installed);
			}
			if (installed.has(group)) return;
			installed.add(group);
			for (const key in methods) {
				const fn = methods[key];
				Object.defineProperty(proto, key, {
					configurable: true,
					enumerable: false,
					get() {
						const bound = fn.bind(this);
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: bound
						});
						return bound;
					},
					set(v) {
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: v
						});
					}
				});
			}
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			$ZodType.init(inst, def);
			Object.assign(inst["~standard"], { jsonSchema: {
				input: createStandardJSONSchemaMethod(inst, "input"),
				output: createStandardJSONSchemaMethod(inst, "output")
			} });
			inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
			inst.def = def;
			inst.type = def.type;
			Object.defineProperty(inst, "_def", { value: def });
			inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
			inst.safeParse = (data, params) => safeParse(inst, data, params);
			inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
			inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
			inst.spa = inst.safeParseAsync;
			inst.encode = (data, params) => encode(inst, data, params);
			inst.decode = (data, params) => decode(inst, data, params);
			inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
			inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
			inst.safeEncode = (data, params) => safeEncode(inst, data, params);
			inst.safeDecode = (data, params) => safeDecode(inst, data, params);
			inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
			inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
			_installLazyMethods(inst, "ZodType", {
				check(...chks) {
					const def = this.def;
					return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
						check: ch,
						def: { check: "custom" },
						onattach: []
					} } : ch)] }), { parent: true });
				},
				with(...chks) {
					return this.check(...chks);
				},
				clone(def, params) {
					return clone(this, def, params);
				},
				brand() {
					return this;
				},
				register(reg, meta) {
					reg.add(this, meta);
					return this;
				},
				refine(check, params) {
					return this.check(refine(check, params));
				},
				superRefine(refinement, params) {
					return this.check(superRefine(refinement, params));
				},
				overwrite(fn) {
					return this.check(/* @__PURE__ */ _overwrite(fn));
				},
				optional() {
					return optional(this);
				},
				exactOptional() {
					return exactOptional(this);
				},
				nullable() {
					return nullable(this);
				},
				nullish() {
					return optional(nullable(this));
				},
				nonoptional(params) {
					return nonoptional(this, params);
				},
				array() {
					return array(this);
				},
				or(arg) {
					return union([this, arg]);
				},
				and(arg) {
					return intersection(this, arg);
				},
				transform(tx) {
					return pipe(this, transform(tx));
				},
				default(d) {
					return _default(this, d);
				},
				prefault(d) {
					return prefault(this, d);
				},
				catch(params) {
					return _catch(this, params);
				},
				pipe(target) {
					return pipe(this, target);
				},
				readonly() {
					return readonly(this);
				},
				describe(description) {
					const cl = this.clone();
					globalRegistry.add(cl, { description });
					return cl;
				},
				meta(...args) {
					if (args.length === 0) return globalRegistry.get(this);
					const cl = this.clone();
					globalRegistry.add(cl, args[0]);
					return cl;
				},
				isOptional() {
					return this.safeParse(void 0).success;
				},
				isNullable() {
					return this.safeParse(null).success;
				},
				apply(fn) {
					return fn(this);
				}
			});
			Object.defineProperty(inst, "description", {
				get() {
					return globalRegistry.get(inst)?.description;
				},
				configurable: true
			});
			return inst;
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
			const bag = inst._zod.bag;
			inst.format = bag.format ?? null;
			inst.minLength = bag.minimum ?? null;
			inst.maxLength = bag.maximum ?? null;
			_installLazyMethods(inst, "_ZodString", {
				regex(...args) {
					return this.check(/* @__PURE__ */ _regex(...args));
				},
				includes(...args) {
					return this.check(/* @__PURE__ */ _includes(...args));
				},
				startsWith(...args) {
					return this.check(/* @__PURE__ */ _startsWith(...args));
				},
				endsWith(...args) {
					return this.check(/* @__PURE__ */ _endsWith(...args));
				},
				min(...args) {
					return this.check(/* @__PURE__ */ _minLength(...args));
				},
				max(...args) {
					return this.check(/* @__PURE__ */ _maxLength(...args));
				},
				length(...args) {
					return this.check(/* @__PURE__ */ _length(...args));
				},
				nonempty(...args) {
					return this.check(/* @__PURE__ */ _minLength(1, ...args));
				},
				lowercase(params) {
					return this.check(/* @__PURE__ */ _lowercase(params));
				},
				uppercase(params) {
					return this.check(/* @__PURE__ */ _uppercase(params));
				},
				trim() {
					return this.check(/* @__PURE__ */ _trim());
				},
				normalize(...args) {
					return this.check(/* @__PURE__ */ _normalize(...args));
				},
				toLowerCase() {
					return this.check(/* @__PURE__ */ _toLowerCase());
				},
				toUpperCase() {
					return this.check(/* @__PURE__ */ _toUpperCase());
				},
				slugify() {
					return this.check(/* @__PURE__ */ _slugify());
				}
			});
		});
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
			inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
			inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
			inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
			inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
			inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
			inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
			inst.datetime = (params) => inst.check(datetime(params));
			inst.date = (params) => inst.check(date(params));
			inst.time = (params) => inst.check(time(params));
			inst.duration = (params) => inst.check(duration(params));
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			_installLazyMethods(inst, "ZodNumber", {
				gt(value, params) {
					return this.check(/* @__PURE__ */ _gt(value, params));
				},
				gte(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				min(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				lt(value, params) {
					return this.check(/* @__PURE__ */ _lt(value, params));
				},
				lte(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				max(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				int(params) {
					return this.check(int(params));
				},
				safe(params) {
					return this.check(int(params));
				},
				positive(params) {
					return this.check(/* @__PURE__ */ _gt(0, params));
				},
				nonnegative(params) {
					return this.check(/* @__PURE__ */ _gte(0, params));
				},
				negative(params) {
					return this.check(/* @__PURE__ */ _lt(0, params));
				},
				nonpositive(params) {
					return this.check(/* @__PURE__ */ _lte(0, params));
				},
				multipleOf(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				step(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				finite() {
					return this;
				}
			});
			const bag = inst._zod.bag;
			inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
			inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
			inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
			inst.isFinite = true;
			inst.format = bag.format ?? null;
		});
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
		}
		const ZodUndefined = /*@__PURE__*/ $constructor("ZodUndefined", (inst, def) => {
			$ZodUndefined.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => undefinedProcessor(inst, ctx, json, params);
		});
		function _undefined(params) {
			return /* @__PURE__ */ _undefined$1(ZodUndefined, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodVoid = /*@__PURE__*/ $constructor("ZodVoid", (inst, def) => {
			$ZodVoid.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => voidProcessor(inst, ctx, json, params);
		});
		function _void(params) {
			return /* @__PURE__ */ _void$1(ZodVoid, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
			_installLazyMethods(inst, "ZodArray", {
				min(n, params) {
					return this.check(/* @__PURE__ */ _minLength(n, params));
				},
				nonempty(params) {
					return this.check(/* @__PURE__ */ _minLength(1, params));
				},
				max(n, params) {
					return this.check(/* @__PURE__ */ _maxLength(n, params));
				},
				length(n, params) {
					return this.check(/* @__PURE__ */ _length(n, params));
				},
				unwrap() {
					return this.element;
				}
			});
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			defineLazy(inst, "shape", () => {
				return def.shape;
			});
			_installLazyMethods(inst, "ZodObject", {
				keyof() {
					return _enum(Object.keys(this._zod.def.shape));
				},
				catchall(catchall) {
					return this.clone({
						...this._zod.def,
						catchall
					});
				},
				passthrough() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				loose() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				strict() {
					return this.clone({
						...this._zod.def,
						catchall: never()
					});
				},
				strip() {
					return this.clone({
						...this._zod.def,
						catchall: void 0
					});
				},
				extend(incoming) {
					return extend(this, incoming);
				},
				safeExtend(incoming) {
					return safeExtend(this, incoming);
				},
				merge(other) {
					return merge(this, other);
				},
				pick(mask) {
					return pick(this, mask);
				},
				omit(mask) {
					return omit(this, mask);
				},
				partial(...args) {
					return partial(ZodOptional, this, args[0]);
				},
				required(...args) {
					return required(ZodNonOptional, this, args[0]);
				}
			});
		});
		function object(shape, params) {
			return new ZodObject({
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			});
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
			$ZodRecord.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
			inst.keyType = def.keyType;
			inst.valueType = def.valueType;
		});
		function record(keyType, valueType, params) {
			if (!valueType || !valueType._zod) return new ZodRecord({
				type: "record",
				keyType: string(),
				valueType: keyType,
				...normalizeParams(valueType)
			});
			return new ZodRecord({
				type: "record",
				keyType,
				valueType,
				...normalizeParams(params)
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = Object.values(def.entries);
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			return new ZodEnum({
				type: "enum",
				entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
				...normalizeParams(params)
			});
		}
		const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
			$ZodLiteral.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
			inst.values = new Set(def.values);
			Object.defineProperty(inst, "value", { get() {
				if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
				return def.values[0];
			} });
		});
		function literal(value, params) {
			return new ZodLiteral({
				type: "literal",
				values: Array.isArray(value) ? value : [value],
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				payload.value = output;
				payload.fallback = true;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodLazy = /*@__PURE__*/ $constructor("ZodLazy", (inst, def) => {
			$ZodLazy.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => lazyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.getter();
		});
		function lazy(getter) {
			return new ZodLazy({
				type: "lazy",
				getter
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		function _instanceof(cls, params = {}) {
			const inst = new ZodCustom({
				type: "custom",
				check: "custom",
				fn: (data) => data instanceof cls,
				abort: true,
				...normalizeParams(params)
			});
			inst._zod.bag.Class = cls;
			inst._zod.check = (payload) => {
				if (!(payload.value instanceof cls)) payload.issues.push({
					code: "invalid_type",
					expected: cls.name,
					input: payload.value,
					inst,
					path: [...inst._zod.def.path ?? []]
				});
			};
			return inst;
		}
		//#endregion
		//#region ../../client/product-analytics/lib/typert.remote-client.js
		let _deepseek_ai_dsh_client_product_analytics_productAnalytics_enabled_result$schema$value;
		const _deepseek_ai_dsh_client_product_analytics_productAnalytics_enabled_result$schema = () => _deepseek_ai_dsh_client_product_analytics_productAnalytics_enabled_result$schema$value ??= boolean();
		let _deepseek_ai_dsh_client_product_analytics_productAnalytics_report_parameter_0$schema$value;
		const _deepseek_ai_dsh_client_product_analytics_productAnalytics_report_parameter_0$schema = () => _deepseek_ai_dsh_client_product_analytics_productAnalytics_report_parameter_0$schema$value ??= union([
			object({
				"eventName": literal("desktop_app_launch"),
				"attributes": record(string(), never()),
				"timestamp": number()
			}),
			object({
				"eventName": literal("auth_page_view"),
				"attributes": record(string(), never()),
				"timestamp": number()
			}),
			object({
				"eventName": literal("auth_page_click"),
				"attributes": object({ "button_name": union([literal("sign_in"), literal("api-key")]) }),
				"timestamp": number()
			}),
			object({
				"eventName": literal("api_key_save_click"),
				"attributes": record(string(), never()),
				"timestamp": number()
			}),
			object({
				"eventName": literal("onboarding_page_view"),
				"attributes": object({ "page_name": union([
					literal("onboarding_welcome"),
					literal("onboarding_recharge"),
					literal("onboarding_use_case"),
					literal("onboarding_process")
				]) }),
				"timestamp": number()
			}),
			object({
				"eventName": literal("onboarding_page_click"),
				"attributes": object({
					"page_name": union([
						literal("onboarding_welcome"),
						literal("onboarding_recharge"),
						literal("onboarding_use_case"),
						literal("onboarding_process")
					]),
					"button_name": union([
						literal("next"),
						literal("back"),
						literal("skip"),
						literal("charge"),
						literal("later"),
						literal("continue")
					]),
					"selected_content": union([
						literal("office"),
						literal("code"),
						literal("code_office"),
						literal("focus_result"),
						literal("key_detail"),
						literal("full_process")
					]).optional()
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("onboarding_popup_view"),
				"attributes": object({ "popup_name": union([literal("skip_charge"), literal("skip_setting")]) }),
				"timestamp": number()
			}),
			object({
				"eventName": literal("onboarding_popup_click"),
				"attributes": object({
					"popup_name": union([literal("skip_charge"), literal("skip_setting")]),
					"button_name": union([
						literal("charge"),
						literal("know"),
						literal("enter"),
						literal("setting"),
						literal("close")
					])
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("desktop_upgrade_click"),
				"attributes": record(string(), never()),
				"timestamp": number()
			}),
			object({
				"eventName": literal("desktop_upgrade_download_result"),
				"attributes": object({
					"is_success": boolean(),
					"error_reason": string().optional()
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("desktop_upgrade_install_restart_click"),
				"attributes": record(string(), never()),
				"timestamp": number()
			}),
			object({
				"eventName": literal("send_button_click"),
				"attributes": object({
					"session_id": intersection(string(), unknown()).optional(),
					"model_name": string().optional(),
					"thinking_effort": string().optional(),
					"run_mode": union([
						literal("goal"),
						literal("plan"),
						literal("default")
					]),
					"msg_type": union([
						literal("queue"),
						literal("steer"),
						literal("default")
					])
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("model_switch"),
				"attributes": object({
					"session_id": intersection(string(), unknown()).optional(),
					"switch_from": string(),
					"switch_to": string()
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("thinking_level_switch"),
				"attributes": object({
					"session_id": intersection(string(), unknown()).optional(),
					"switch_from": string(),
					"switch_to": string(),
					"model_name": string()
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("context_compression"),
				"attributes": object({
					"session_id": intersection(string(), unknown()),
					"trigger_type": union([literal("auto"), literal("manual")])
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("branch_session_click"),
				"attributes": object({
					"session_id": intersection(string(), unknown()),
					"parent_session_id": intersection(string(), unknown()),
					"parent_message_id": intersection(string(), unknown()).optional(),
					"click_position": union([literal("footer"), literal("sidebar")])
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("sidebar_menu_click"),
				"attributes": object({ "menu_name": union([literal("plugin"), literal("cron")]) }),
				"timestamp": number()
			}),
			object({
				"eventName": literal("plugin_toggle"),
				"attributes": object({
					"plugin_name": string(),
					"plugin_type": union([literal("plugin"), literal("bundle")]),
					"is_enabled": boolean(),
					"is_builtin": boolean()
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("plugin_add_button_click"),
				"attributes": record(string(), never()),
				"timestamp": number()
			}),
			object({
				"eventName": literal("plugin_install_click"),
				"attributes": object({ "input_value": string() }),
				"timestamp": number()
			}),
			object({
				"eventName": literal("install_plugin_result"),
				"attributes": object({
					"input_value": string(),
					"is_success": boolean(),
					"error_reason": string().optional(),
					"duration": number(),
					"plugin_name": string().optional()
				}),
				"timestamp": number()
			}),
			object({
				"eventName": literal("confirm_uninstall_plugin"),
				"attributes": object({ "plugin_name": string() }),
				"timestamp": number()
			})
		]);
		let _deepseek_ai_dsh_client_product_analytics_productAnalytics_report_result$schema$value;
		const _deepseek_ai_dsh_client_product_analytics_productAnalytics_report_result$schema = () => _deepseek_ai_dsh_client_product_analytics_productAnalytics_report_result$schema$value ??= _void();
		let _deepseek_ai_dsh_client_product_analytics_productAnalytics_watchPolicy_result$schema$value;
		const _deepseek_ai_dsh_client_product_analytics_productAnalytics_watchPolicy_result$schema = () => _deepseek_ai_dsh_client_product_analytics_productAnalytics_watchPolicy_result$schema$value ??= boolean();
		const TYPERT_REMOTE$24 = {
			package: "@deepseek-ai/dsh-client-product-analytics",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-client-product-analytics#productAnalytics/enabled",
					service: "productAnalytics",
					namespace: "productAnalytics",
					method: "enabled",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-client-product-analytics#productAnalytics/enabled:result",
						create: _deepseek_ai_dsh_client_product_analytics_productAnalytics_enabled_result$schema
					},
					sourceLocation: {
						"file": "packages/client/product-analytics/src/index.ts",
						"line": 51,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-client-product-analytics#productAnalytics/report",
					service: "productAnalytics",
					namespace: "productAnalytics",
					method: "report",
					invocation: { kind: "direct" },
					parameters: [{
						name: "event",
						wire: "event",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-client-product-analytics/types#ProductEvent",
							create: _deepseek_ai_dsh_client_product_analytics_productAnalytics_report_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-client-product-analytics#productAnalytics/report:result",
						create: _deepseek_ai_dsh_client_product_analytics_productAnalytics_report_result$schema
					},
					sourceLocation: {
						"file": "packages/client/product-analytics/src/index.ts",
						"line": 82,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-client-product-analytics#productAnalytics/watchPolicy",
					service: "productAnalytics",
					namespace: "productAnalytics",
					method: "watchPolicy",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-client-product-analytics#productAnalytics/watchPolicy:result",
						create: _deepseek_ai_dsh_client_product_analytics_productAnalytics_watchPolicy_result$schema
					},
					sourceLocation: {
						"file": "packages/client/product-analytics/src/index.ts",
						"line": 59,
						"column": 10
					}
				}
			]
		};
		//#endregion
		//#region ../../preset/agent-preset-registry/lib/typert.remote-client.js
		let _deepseek_ai_dsh_agent_preset_registry_agentPresets_list_result$schema$value;
		const _deepseek_ai_dsh_agent_preset_registry_agentPresets_list_result$schema = () => _deepseek_ai_dsh_agent_preset_registry_agentPresets_list_result$schema$value ??= object({ "presets": array(object({
			"id": string().readonly(),
			"isDefault": boolean().readonly(),
			"name": string().readonly().optional(),
			"description": string().readonly().optional(),
			"broken": string().readonly().optional()
		})).readonly() });
		let _deepseek_ai_dsh_agent_preset_registry_agentPresets_read_parameter_0$schema$value;
		const _deepseek_ai_dsh_agent_preset_registry_agentPresets_read_parameter_0$schema = () => _deepseek_ai_dsh_agent_preset_registry_agentPresets_read_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_agent_preset_registry_agentPresets_read_result$schema$value;
		const _deepseek_ai_dsh_agent_preset_registry_agentPresets_read_result$schema = () => _deepseek_ai_dsh_agent_preset_registry_agentPresets_read_result$schema$value ??= object({
			"agentPreset": string().readonly(),
			"content": string().readonly(),
			"name": string().readonly().optional(),
			"description": string().readonly().optional()
		});
		let _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_parameter_0$schema$value;
		const _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_parameter_0$schema = () => _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_parameter_1$schema$value;
		const _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_parameter_1$schema = () => _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_result$schema$value;
		const _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_result$schema = () => _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_result$schema$value ??= string();
		const TYPERT_REMOTE$23 = {
			package: "@deepseek-ai/dsh-agent-preset-registry",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-agent-preset-registry#agentPresets/list",
					service: "agentPresets",
					namespace: "agentPresets",
					method: "list",
					implementation: "remoteExportList",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-agent-preset-registry/types#AgentPresetRoster",
						create: _deepseek_ai_dsh_agent_preset_registry_agentPresets_list_result$schema
					},
					sourceLocation: {
						"file": "packages/preset/agent-preset-registry/src/index.ts",
						"line": 195,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-agent-preset-registry#agentPresets/read",
					service: "agentPresets",
					namespace: "agentPresets",
					method: "read",
					implementation: "readDocument",
					invocation: { kind: "direct" },
					parameters: [{
						name: "agentPreset",
						wire: "agentPreset",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-agent-preset-registry#agentPresets/read:agentPreset",
							create: _deepseek_ai_dsh_agent_preset_registry_agentPresets_read_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-agent-preset-registry/types#AgentPresetDocument",
						create: _deepseek_ai_dsh_agent_preset_registry_agentPresets_read_result$schema
					},
					sourceLocation: {
						"file": "packages/preset/agent-preset-registry/src/index.ts",
						"line": 218,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-agent-preset-registry#agentPresets/select",
					service: "agentPresets",
					namespace: "agentPresets",
					method: "select",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_parameter_0$schema
						}
					}, {
						name: "agentPreset",
						wire: "agentPreset",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-agent-preset-registry#agentPresets/select:agentPreset",
							create: _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-agent-preset-registry#agentPresets/select:result",
						create: _deepseek_ai_dsh_agent_preset_registry_agentPresets_select_result$schema
					},
					sourceLocation: {
						"file": "packages/preset/agent-preset-registry/src/index.ts",
						"line": 347,
						"column": 9
					}
				}
			]
		};
		//#endregion
		//#region ../../interaction/user-questions/lib/typert.remote-client.js
		let _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_0$schema$value;
		const _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_0$schema = () => _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_1$schema$value;
		const _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_1$schema = () => _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_2$schema$value;
		const _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_2$schema = () => _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_2$schema$value ??= object({ "answers": array(object({
			"id": string(),
			"selected": array(string()),
			"custom": string().optional()
		})) });
		let _deepseek_ai_dsh_user_questions_userQuestions_answer_result$schema$value;
		const _deepseek_ai_dsh_user_questions_userQuestions_answer_result$schema = () => _deepseek_ai_dsh_user_questions_userQuestions_answer_result$schema$value ??= boolean();
		let _deepseek_ai_dsh_user_questions_userQuestions_attachWait_parameter_0$schema$value;
		const _deepseek_ai_dsh_user_questions_userQuestions_attachWait_parameter_0$schema = () => _deepseek_ai_dsh_user_questions_userQuestions_attachWait_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_user_questions_userQuestions_attachWait_parameter_1$schema$value;
		const _deepseek_ai_dsh_user_questions_userQuestions_attachWait_parameter_1$schema = () => _deepseek_ai_dsh_user_questions_userQuestions_attachWait_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_user_questions_userQuestions_attachWait_result$schema$value;
		const _deepseek_ai_dsh_user_questions_userQuestions_attachWait_result$schema = () => _deepseek_ai_dsh_user_questions_userQuestions_attachWait_result$schema$value ??= object({ "remainingMs": number() });
		const TYPERT_REMOTE$22 = {
			package: "@deepseek-ai/dsh-user-questions",
			descriptors: [{
				id: "@deepseek-ai/dsh-user-questions#userQuestions/answer",
				service: "userQuestions",
				namespace: "userQuestions",
				method: "answer",
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [
					{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_0$schema
						}
					},
					{
						name: "callId",
						wire: "callId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-llm/brand#ToolCallId",
							create: _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_1$schema
						}
					},
					{
						name: "answer",
						wire: "answer",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-user-questions/types#AskUserQuestionAnswer",
							create: _deepseek_ai_dsh_user_questions_userQuestions_answer_parameter_2$schema
						}
					}
				],
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-user-questions#userQuestions/answer:result",
					create: _deepseek_ai_dsh_user_questions_userQuestions_answer_result$schema
				},
				sourceLocation: {
					"file": "packages/interaction/user-questions/src/index.ts",
					"line": 165,
					"column": 3
				}
			}, {
				id: "@deepseek-ai/dsh-user-questions#userQuestions/attachWait",
				service: "userQuestions",
				namespace: "userQuestions",
				method: "attachWait",
				mode: "stream",
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [{
					name: "agent",
					wire: "agentId",
					source: "lookup",
					lookup: "agent",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
						create: _deepseek_ai_dsh_user_questions_userQuestions_attachWait_parameter_0$schema
					}
				}, {
					name: "callId",
					wire: "callId",
					source: "json",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-llm/brand#ToolCallId",
						create: _deepseek_ai_dsh_user_questions_userQuestions_attachWait_parameter_1$schema
					}
				}],
				cancellation: { parameter: "signal" },
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-user-questions#userQuestions/attachWait:result",
					create: _deepseek_ai_dsh_user_questions_userQuestions_attachWait_result$schema
				},
				sourceLocation: {
					"file": "packages/interaction/user-questions/src/index.ts",
					"line": 216,
					"column": 10
				}
			}]
		};
		//#endregion
		//#region ../../interaction/commands/lib/typert.remote-client.js
		let _deepseek_ai_dsh_commands_commands_execute_parameter_0$schema$value;
		const _deepseek_ai_dsh_commands_commands_execute_parameter_0$schema = () => _deepseek_ai_dsh_commands_commands_execute_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_commands_commands_execute_parameter_1$schema$value;
		const _deepseek_ai_dsh_commands_commands_execute_parameter_1$schema = () => _deepseek_ai_dsh_commands_commands_execute_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_commands_commands_execute_parameter_2$schema$value;
		const _deepseek_ai_dsh_commands_commands_execute_parameter_2$schema = () => _deepseek_ai_dsh_commands_commands_execute_parameter_2$schema$value ??= array(union([intersection(object({ "type": literal("image").readonly() }), object({
			"mediaType": union([
				literal("image/png"),
				literal("image/jpeg"),
				literal("image/webp"),
				literal("image/gif")
			]),
			"data": string(),
			"name": string().optional()
		})), object({
			"type": literal("file").readonly(),
			"receiptId": string().readonly()
		})]));
		let _deepseek_ai_dsh_commands_commands_execute_result$schema$value;
		const _deepseek_ai_dsh_commands_commands_execute_result$schema = () => _deepseek_ai_dsh_commands_commands_execute_result$schema$value ??= union([_undefined(), object({
			"commandId": intersection(string(), unknown()).readonly(),
			"result": union([object({
				"kind": literal("success").readonly(),
				"text": string().readonly().optional(),
				"sourceEventSeq": intersection(number(), unknown()).readonly().optional()
			}), object({
				"kind": literal("error").readonly(),
				"text": string().readonly()
			})]).readonly()
		})]);
		let _deepseek_ai_dsh_commands_commands_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_commands_commands_list_parameter_0$schema = () => _deepseek_ai_dsh_commands_commands_list_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_commands_commands_list_result$schema$value;
		const _deepseek_ai_dsh_commands_commands_list_result$schema = () => _deepseek_ai_dsh_commands_commands_list_result$schema$value ??= array(object({
			"definitionId": intersection(string(), unknown()).readonly().optional(),
			"name": string().readonly(),
			"description": string().readonly(),
			"input": object({
				"hint": string().readonly(),
				"attachments": boolean().readonly().optional()
			}).readonly().optional()
		}));
		const TYPERT_REMOTE$21 = {
			package: "@deepseek-ai/dsh-commands",
			descriptors: [{
				id: "@deepseek-ai/dsh-commands#commands/execute",
				service: "commands",
				namespace: "commands",
				method: "execute",
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [
					{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_commands_commands_execute_parameter_0$schema
						}
					},
					{
						name: "line",
						wire: "line",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-commands#commands/execute:line",
							create: _deepseek_ai_dsh_commands_commands_execute_parameter_1$schema
						}
					},
					{
						name: "submittedAttachments",
						wire: "submittedAttachments",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-commands#commands/execute:submittedAttachments",
							create: _deepseek_ai_dsh_commands_commands_execute_parameter_2$schema
						}
					}
				],
				cancellation: { parameter: "signal" },
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-commands#commands/execute:result",
					create: _deepseek_ai_dsh_commands_commands_execute_result$schema
				},
				sourceLocation: {
					"file": "packages/interaction/commands/src/index.ts",
					"line": 361,
					"column": 9
				}
			}, {
				id: "@deepseek-ai/dsh-commands#commands/list",
				service: "commands",
				namespace: "commands",
				method: "list",
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [{
					name: "agent",
					wire: "agentId",
					source: "lookup",
					lookup: "agent",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
						create: _deepseek_ai_dsh_commands_commands_list_parameter_0$schema
					}
				}],
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-commands#commands/list:result",
					create: _deepseek_ai_dsh_commands_commands_list_result$schema
				},
				sourceLocation: {
					"file": "packages/interaction/commands/src/index.ts",
					"line": 315,
					"column": 3
				}
			}]
		};
		//#endregion
		//#region ../account-controller/lib/typert.remote-client.js
		let _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_0$schema = () => _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_1$schema = () => _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_2$schema = () => _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_2$schema$value ??= object({
			"version": string().readonly(),
			"locale": string().readonly(),
			"timezoneOffsetSeconds": number().readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_result$schema$value ??= boolean();
		let _deepseek_ai_dsh_api_account_controller_account_cancelSignIn_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_cancelSignIn_parameter_0$schema = () => _deepseek_ai_dsh_api_account_controller_account_cancelSignIn_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_account_controller_account_cancelSignIn_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_cancelSignIn_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_cancelSignIn_result$schema$value ??= object({
			"status": union([literal("signed-out"), literal("credential-stored")]).readonly(),
			"links": object({
				"usageUrl": string().readonly(),
				"topUpUrl": string().readonly()
			}).readonly(),
			"attempt": union([literal(null), object({
				"id": intersection(string(), unknown()).readonly(),
				"phase": union([
					literal("initializing"),
					literal("waiting-browser"),
					literal("exchanging"),
					literal("committing"),
					literal("succeeded"),
					literal("cancelled"),
					literal("expired"),
					literal("failed")
				]).readonly(),
				"authorizeUrl": string().readonly().optional(),
				"expiresAt": number().readonly().optional(),
				"errorCode": union([
					literal("expired"),
					literal("no-response"),
					literal("network"),
					literal("protocol"),
					literal("storage")
				]).readonly().optional()
			})]).readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_getBalance_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_getBalance_parameter_0$schema = () => _deepseek_ai_dsh_api_account_controller_account_getBalance_parameter_0$schema$value ??= object({
			"version": string().readonly(),
			"locale": string().readonly(),
			"timezoneOffsetSeconds": number().readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_getBalance_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_getBalance_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_getBalance_result$schema$value ??= union([
			literal(null),
			object({
				"status": literal("ready").readonly(),
				"value": array(object({
					"currency": union([literal("CNY"), literal("USD")]).readonly(),
					"balance": string().readonly()
				})).readonly(),
				"bonusWallets": array(object({
					"currency": union([literal("CNY"), literal("USD")]).readonly(),
					"balance": string().readonly()
				})).readonly()
			}),
			object({ "status": literal("failed").readonly() })
		]);
		let _deepseek_ai_dsh_api_account_controller_account_getProfile_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_getProfile_parameter_0$schema = () => _deepseek_ai_dsh_api_account_controller_account_getProfile_parameter_0$schema$value ??= object({
			"version": string().readonly(),
			"locale": string().readonly(),
			"timezoneOffsetSeconds": number().readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_getProfile_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_getProfile_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_getProfile_result$schema$value ??= union([
			literal(null),
			object({
				"status": literal("ready").readonly(),
				"value": object({
					"id": union([literal(null), intersection(string(), unknown())]).readonly(),
					"name": union([literal(null), string()]).readonly(),
					"contact": union([literal(null), string()]).readonly(),
					"avatarUrl": union([literal(null), string()]).readonly().optional()
				}).readonly()
			}),
			object({ "status": literal("failed").readonly() })
		]);
		let _deepseek_ai_dsh_api_account_controller_account_getState_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_getState_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_getState_result$schema$value ??= object({
			"status": union([literal("signed-out"), literal("credential-stored")]).readonly(),
			"links": object({
				"usageUrl": string().readonly(),
				"topUpUrl": string().readonly()
			}).readonly(),
			"attempt": union([literal(null), object({
				"id": intersection(string(), unknown()).readonly(),
				"phase": union([
					literal("initializing"),
					literal("waiting-browser"),
					literal("exchanging"),
					literal("committing"),
					literal("succeeded"),
					literal("cancelled"),
					literal("expired"),
					literal("failed")
				]).readonly(),
				"authorizeUrl": string().readonly().optional(),
				"expiresAt": number().readonly().optional(),
				"errorCode": union([
					literal("expired"),
					literal("no-response"),
					literal("network"),
					literal("protocol"),
					literal("storage")
				]).readonly().optional()
			})]).readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_getUnnotifiedBonuses_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_getUnnotifiedBonuses_parameter_0$schema = () => _deepseek_ai_dsh_api_account_controller_account_getUnnotifiedBonuses_parameter_0$schema$value ??= object({
			"version": string().readonly(),
			"locale": string().readonly(),
			"timezoneOffsetSeconds": number().readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_getUnnotifiedBonuses_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_getUnnotifiedBonuses_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_getUnnotifiedBonuses_result$schema$value ??= union([literal(null), object({
			"accountId": intersection(string(), unknown()).readonly(),
			"bonuses": array(object({
				"orderId": intersection(string(), unknown()).readonly(),
				"campaign": string().readonly(),
				"amount": string().readonly(),
				"currency": union([literal("CNY"), literal("USD")]).readonly(),
				"grantedAt": string().readonly(),
				"expiresAt": string().readonly(),
				"message": string().readonly()
			})).readonly()
		})]);
		let _deepseek_ai_dsh_api_account_controller_account_hasRunningAccountTasks_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_hasRunningAccountTasks_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_hasRunningAccountTasks_result$schema$value ??= boolean();
		let _deepseek_ai_dsh_api_account_controller_account_signOut_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_signOut_parameter_0$schema = () => _deepseek_ai_dsh_api_account_controller_account_signOut_parameter_0$schema$value ??= object({
			"version": string().readonly(),
			"locale": string().readonly(),
			"timezoneOffsetSeconds": number().readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_signOut_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_signOut_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_signOut_result$schema$value ??= object({
			"status": union([literal("signed-out"), literal("credential-stored")]).readonly(),
			"links": object({
				"usageUrl": string().readonly(),
				"topUpUrl": string().readonly()
			}).readonly(),
			"attempt": union([literal(null), object({
				"id": intersection(string(), unknown()).readonly(),
				"phase": union([
					literal("initializing"),
					literal("waiting-browser"),
					literal("exchanging"),
					literal("committing"),
					literal("succeeded"),
					literal("cancelled"),
					literal("expired"),
					literal("failed")
				]).readonly(),
				"authorizeUrl": string().readonly().optional(),
				"expiresAt": number().readonly().optional(),
				"errorCode": union([
					literal("expired"),
					literal("no-response"),
					literal("network"),
					literal("protocol"),
					literal("storage")
				]).readonly().optional()
			})]).readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_0$schema = () => _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_0$schema$value ??= object({
			"version": string().readonly(),
			"locale": string().readonly(),
			"timezoneOffsetSeconds": number().readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_1$schema = () => _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_2$schema = () => _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_2$schema$value ??= union([literal("web"), literal("desktop")]);
		let _deepseek_ai_dsh_api_account_controller_account_startSignIn_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_startSignIn_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_startSignIn_result$schema$value ??= object({
			"status": union([literal("signed-out"), literal("credential-stored")]).readonly(),
			"links": object({
				"usageUrl": string().readonly(),
				"topUpUrl": string().readonly()
			}).readonly(),
			"attempt": union([literal(null), object({
				"id": intersection(string(), unknown()).readonly(),
				"phase": union([
					literal("initializing"),
					literal("waiting-browser"),
					literal("exchanging"),
					literal("committing"),
					literal("succeeded"),
					literal("cancelled"),
					literal("expired"),
					literal("failed")
				]).readonly(),
				"authorizeUrl": string().readonly().optional(),
				"expiresAt": number().readonly().optional(),
				"errorCode": union([
					literal("expired"),
					literal("no-response"),
					literal("network"),
					literal("protocol"),
					literal("storage")
				]).readonly().optional()
			})]).readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_watch_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_watch_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_watch_result$schema$value ??= object({
			"status": union([literal("signed-out"), literal("credential-stored")]).readonly(),
			"links": object({
				"usageUrl": string().readonly(),
				"topUpUrl": string().readonly()
			}).readonly(),
			"attempt": union([literal(null), object({
				"id": intersection(string(), unknown()).readonly(),
				"phase": union([
					literal("initializing"),
					literal("waiting-browser"),
					literal("exchanging"),
					literal("committing"),
					literal("succeeded"),
					literal("cancelled"),
					literal("expired"),
					literal("failed")
				]).readonly(),
				"authorizeUrl": string().readonly().optional(),
				"expiresAt": number().readonly().optional(),
				"errorCode": union([
					literal("expired"),
					literal("no-response"),
					literal("network"),
					literal("protocol"),
					literal("storage")
				]).readonly().optional()
			})]).readonly()
		});
		let _deepseek_ai_dsh_api_account_controller_account_watchExpiry_result$schema$value;
		const _deepseek_ai_dsh_api_account_controller_account_watchExpiry_result$schema = () => _deepseek_ai_dsh_api_account_controller_account_watchExpiry_result$schema$value ??= literal("session-expired");
		const TYPERT_REMOTE$20 = {
			package: "@deepseek-ai/dsh-api-account-controller",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/ackBonusNotified",
					service: "accountController",
					namespace: "account",
					method: "ackBonusNotified",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "accountId",
							wire: "accountId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountUserId",
								create: _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_0$schema
							}
						},
						{
							name: "orderId",
							wire: "orderId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountBonusOrderId",
								create: _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_1$schema
							}
						},
						{
							name: "client",
							wire: "client",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountClientMetadata",
								create: _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-account-controller#account/ackBonusNotified:result",
						create: _deepseek_ai_dsh_api_account_controller_account_ackBonusNotified_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 55,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/cancelSignIn",
					service: "accountController",
					namespace: "account",
					method: "cancelSignIn",
					invocation: { kind: "direct" },
					parameters: [{
						name: "attemptId",
						wire: "attemptId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#SignInAttemptId",
							create: _deepseek_ai_dsh_api_account_controller_account_cancelSignIn_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountView",
						create: _deepseek_ai_dsh_api_account_controller_account_cancelSignIn_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 75,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/getBalance",
					service: "accountController",
					namespace: "account",
					method: "getBalance",
					invocation: { kind: "direct" },
					parameters: [{
						name: "client",
						wire: "client",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountClientMetadata",
							create: _deepseek_ai_dsh_api_account_controller_account_getBalance_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-account-controller#account/getBalance:result",
						create: _deepseek_ai_dsh_api_account_controller_account_getBalance_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 35,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/getProfile",
					service: "accountController",
					namespace: "account",
					method: "getProfile",
					invocation: { kind: "direct" },
					parameters: [{
						name: "client",
						wire: "client",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountClientMetadata",
							create: _deepseek_ai_dsh_api_account_controller_account_getProfile_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-account-controller#account/getProfile:result",
						create: _deepseek_ai_dsh_api_account_controller_account_getProfile_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 26,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/getState",
					service: "accountController",
					namespace: "account",
					method: "getState",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountView",
						create: _deepseek_ai_dsh_api_account_controller_account_getState_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 19,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/getUnnotifiedBonuses",
					service: "accountController",
					namespace: "account",
					method: "getUnnotifiedBonuses",
					invocation: { kind: "direct" },
					parameters: [{
						name: "client",
						wire: "client",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountClientMetadata",
							create: _deepseek_ai_dsh_api_account_controller_account_getUnnotifiedBonuses_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-account-controller#account/getUnnotifiedBonuses:result",
						create: _deepseek_ai_dsh_api_account_controller_account_getUnnotifiedBonuses_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 44,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/hasRunningAccountTasks",
					service: "accountController",
					namespace: "account",
					method: "hasRunningAccountTasks",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-account-controller#account/hasRunningAccountTasks:result",
						create: _deepseek_ai_dsh_api_account_controller_account_hasRunningAccountTasks_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 81,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/signOut",
					service: "accountController",
					namespace: "account",
					method: "signOut",
					invocation: { kind: "direct" },
					parameters: [{
						name: "client",
						wire: "client",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountClientMetadata",
							create: _deepseek_ai_dsh_api_account_controller_account_signOut_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountView",
						create: _deepseek_ai_dsh_api_account_controller_account_signOut_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 90,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/startSignIn",
					service: "accountController",
					namespace: "account",
					method: "startSignIn",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "client",
							wire: "client",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountClientMetadata",
								create: _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_0$schema
							}
						},
						{
							name: "callbackOrigin",
							wire: "callbackOrigin",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-account-controller#account/startSignIn:callbackOrigin",
								create: _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_1$schema
							}
						},
						{
							name: "loginSource",
							wire: "loginSource",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-account-controller#account/startSignIn:loginSource",
								create: _deepseek_ai_dsh_api_account_controller_account_startSignIn_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountView",
						create: _deepseek_ai_dsh_api_account_controller_account_startSignIn_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 66,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/watch",
					service: "accountController",
					namespace: "account",
					method: "watch",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-deepseek-account/types#AccountView",
						create: _deepseek_ai_dsh_api_account_controller_account_watch_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 119,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-account-controller#account/watchExpiry",
					service: "accountController",
					namespace: "account",
					method: "watchExpiry",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-account-controller#account/watchExpiry:result",
						create: _deepseek_ai_dsh_api_account_controller_account_watchExpiry_result$schema
					},
					sourceLocation: {
						"file": "packages/api/account-controller/src/index.ts",
						"line": 97,
						"column": 10
					}
				}
			]
		};
		//#endregion
		//#region ../settings-controller/lib/typert.remote-client.js
		let JsonValueRemoteCodec$schema$value$2;
		const JsonValueRemoteCodec$schema$2 = () => JsonValueRemoteCodec$schema$value$2 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema$2())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema$2()))
		]);
		let JsonValueRemoteCodec$schema2$value$2;
		const JsonValueRemoteCodec$schema2$2 = () => JsonValueRemoteCodec$schema2$value$2 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema2$2())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema2$2()))
		]);
		let JsonValueRemoteCodec$schema3$value$2;
		const JsonValueRemoteCodec$schema3$2 = () => JsonValueRemoteCodec$schema3$value$2 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema3$2())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema3$2()))
		]);
		let JsonValueRemoteCodec$schema4$value$2;
		const JsonValueRemoteCodec$schema4$2 = () => JsonValueRemoteCodec$schema4$value$2 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema4$2())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema4$2()))
		]);
		let JsonValueRemoteCodec$schema5$value$1;
		const JsonValueRemoteCodec$schema5$1 = () => JsonValueRemoteCodec$schema5$value$1 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema5$1())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema5$1()))
		]);
		let JsonValueRemoteCodec$schema6$value;
		const JsonValueRemoteCodec$schema6 = () => JsonValueRemoteCodec$schema6$value ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema6())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema6()))
		]);
		let JsonValueRemoteCodec$schema7$value;
		const JsonValueRemoteCodec$schema7 = () => JsonValueRemoteCodec$schema7$value ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema7())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema7()))
		]);
		let _deepseek_ai_dsh_api_settings_controller_credentials_describe_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_credentials_describe_parameter_0$schema = () => _deepseek_ai_dsh_api_settings_controller_credentials_describe_parameter_0$schema$value ??= array(string());
		let _deepseek_ai_dsh_api_settings_controller_credentials_describe_result$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_credentials_describe_result$schema = () => _deepseek_ai_dsh_api_settings_controller_credentials_describe_result$schema$value ??= record(string(), object({
			"configured": boolean(),
			"source": string().optional(),
			"writable": boolean()
		}));
		let _deepseek_ai_dsh_api_settings_controller_credentials_set_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_credentials_set_parameter_0$schema = () => _deepseek_ai_dsh_api_settings_controller_credentials_set_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_api_settings_controller_credentials_set_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_credentials_set_parameter_1$schema = () => _deepseek_ai_dsh_api_settings_controller_credentials_set_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_settings_controller_credentials_set_result$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_credentials_set_result$schema = () => _deepseek_ai_dsh_api_settings_controller_credentials_set_result$schema$value ??= _void();
		let _deepseek_ai_dsh_api_settings_controller_credentials_unset_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_credentials_unset_parameter_0$schema = () => _deepseek_ai_dsh_api_settings_controller_credentials_unset_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_api_settings_controller_credentials_unset_result$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_credentials_unset_result$schema = () => _deepseek_ai_dsh_api_settings_controller_credentials_unset_result$schema$value ??= _void();
		let _deepseek_ai_dsh_api_settings_controller_settings_describe_result$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_describe_result$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_describe_result$schema$value ??= object({
			"writable": boolean(),
			"hasDocument": boolean(),
			"namespaces": array(object({
				"autoGenerate": boolean(),
				"ns": string(),
				"schema": union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema7())),
					record(string(), lazy(() => JsonValueRemoteCodec$schema7()))
				]),
				"value": union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema7())),
					record(string(), lazy(() => JsonValueRemoteCodec$schema7()))
				]),
				"base": union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema7())),
					record(string(), lazy(() => JsonValueRemoteCodec$schema7()))
				]).optional(),
				"user": union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema7())),
					record(string(), lazy(() => JsonValueRemoteCodec$schema7()))
				]).optional(),
				"applies": literal("live"),
				"secrets": array(object({
					"path": array(string()),
					"set": boolean()
				})),
				"revision": number()
			}))
		});
		let _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_0$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_1$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_1$schema$value ??= array(union([object({
			"op": literal("set"),
			"path": array(string()),
			"value": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema5$1())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema5$1()))
			])
		}), object({
			"op": literal("unset"),
			"path": array(string())
		})]));
		let _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_2$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_2$schema$value ??= union([_undefined(), number()]);
		let _deepseek_ai_dsh_api_settings_controller_settings_mutate_result$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_mutate_result$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_mutate_result$schema$value ??= object({
			"autoGenerate": boolean(),
			"ns": string(),
			"schema": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema6())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema6()))
			]),
			"value": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema6())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema6()))
			]),
			"base": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema6())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema6()))
			]).optional(),
			"user": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema6())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema6()))
			]).optional(),
			"applies": literal("live"),
			"secrets": array(object({
				"path": array(string()),
				"set": boolean()
			})),
			"revision": number()
		});
		let _deepseek_ai_dsh_api_settings_controller_settings_openSettingsDocument_result$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_openSettingsDocument_result$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_openSettingsDocument_result$schema$value ??= object({ "opened": literal(true).readonly() });
		let _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_0$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_1$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_1$schema$value ??= record(string(), union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema3$2())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema3$2()))
		]));
		let _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_2$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_2$schema$value ??= union([_undefined(), number()]);
		let _deepseek_ai_dsh_api_settings_controller_settings_replace_result$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_replace_result$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_replace_result$schema$value ??= object({
			"autoGenerate": boolean(),
			"ns": string(),
			"schema": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema4$2())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema4$2()))
			]),
			"value": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema4$2())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema4$2()))
			]),
			"base": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema4$2())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema4$2()))
			]).optional(),
			"user": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema4$2())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema4$2()))
			]).optional(),
			"applies": literal("live"),
			"secrets": array(object({
				"path": array(string()),
				"set": boolean()
			})),
			"revision": number()
		});
		let _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_0$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_1$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_1$schema$value ??= record(string(), union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema$2())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema$2()))
		]));
		let _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_2$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_2$schema$value ??= union([_undefined(), number()]);
		let _deepseek_ai_dsh_api_settings_controller_settings_update_result$schema$value;
		const _deepseek_ai_dsh_api_settings_controller_settings_update_result$schema = () => _deepseek_ai_dsh_api_settings_controller_settings_update_result$schema$value ??= object({
			"autoGenerate": boolean(),
			"ns": string(),
			"schema": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema2$2())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema2$2()))
			]),
			"value": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema2$2())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema2$2()))
			]),
			"base": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema2$2())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema2$2()))
			]).optional(),
			"user": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema2$2())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema2$2()))
			]).optional(),
			"applies": literal("live"),
			"secrets": array(object({
				"path": array(string()),
				"set": boolean()
			})),
			"revision": number()
		});
		const TYPERT_REMOTE$19 = {
			package: "@deepseek-ai/dsh-api-settings-controller",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-api-settings-controller#credentials/describe",
					service: "credentialsController",
					namespace: "credentials",
					method: "describe",
					invocation: { kind: "direct" },
					parameters: [{
						name: "refs",
						wire: "refs",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/describe:refs",
							create: _deepseek_ai_dsh_api_settings_controller_credentials_describe_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/describe:result",
						create: _deepseek_ai_dsh_api_settings_controller_credentials_describe_result$schema
					},
					sourceLocation: {
						"file": "packages/api/settings-controller/src/credentials.ts",
						"line": 83,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-settings-controller#credentials/set",
					service: "credentialsController",
					namespace: "credentials",
					method: "set",
					invocation: { kind: "direct" },
					parameters: [{
						name: "ref",
						wire: "ref",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/set:ref",
							create: _deepseek_ai_dsh_api_settings_controller_credentials_set_parameter_0$schema
						}
					}, {
						name: "value",
						wire: "value",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/set:value",
							create: _deepseek_ai_dsh_api_settings_controller_credentials_set_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/set:result",
						create: _deepseek_ai_dsh_api_settings_controller_credentials_set_result$schema
					},
					sourceLocation: {
						"file": "packages/api/settings-controller/src/credentials.ts",
						"line": 100,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-settings-controller#credentials/unset",
					service: "credentialsController",
					namespace: "credentials",
					method: "unset",
					invocation: { kind: "direct" },
					parameters: [{
						name: "ref",
						wire: "ref",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/unset:ref",
							create: _deepseek_ai_dsh_api_settings_controller_credentials_unset_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-settings-controller#credentials/unset:result",
						create: _deepseek_ai_dsh_api_settings_controller_credentials_unset_result$schema
					},
					sourceLocation: {
						"file": "packages/api/settings-controller/src/credentials.ts",
						"line": 113,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-settings-controller#settings/describe",
					service: "settingsController",
					namespace: "settings",
					method: "describe",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-settings/types#SettingsDescribeValue",
						create: _deepseek_ai_dsh_api_settings_controller_settings_describe_result$schema
					},
					sourceLocation: {
						"file": "packages/api/settings-controller/src/index.ts",
						"line": 98,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-settings-controller#settings/mutate",
					service: "settingsController",
					namespace: "settings",
					method: "mutate",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "ns",
							wire: "ns",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/mutate:ns",
								create: _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_0$schema
							}
						},
						{
							name: "ops",
							wire: "ops",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/mutate:ops",
								create: _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_1$schema
							}
						},
						{
							name: "expectedRevision",
							wire: "expectedRevision",
							source: "json",
							acceptsUndefined: true,
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/mutate:expectedRevision",
								create: _deepseek_ai_dsh_api_settings_controller_settings_mutate_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-settings/types#SettingsNamespaceView",
						create: _deepseek_ai_dsh_api_settings_controller_settings_mutate_result$schema
					},
					sourceLocation: {
						"file": "packages/api/settings-controller/src/index.ts",
						"line": 152,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-settings-controller#settings/openSettingsDocument",
					service: "settingsController",
					namespace: "settings",
					method: "openSettingsDocument",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-settings-controller/types#SettingsDocumentOpenValue",
						create: _deepseek_ai_dsh_api_settings_controller_settings_openSettingsDocument_result$schema
					},
					sourceLocation: {
						"file": "packages/api/settings-controller/src/index.ts",
						"line": 167,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-settings-controller#settings/replace",
					service: "settingsController",
					namespace: "settings",
					method: "replace",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "ns",
							wire: "ns",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/replace:ns",
								create: _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_0$schema
							}
						},
						{
							name: "section",
							wire: "section",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/replace:section",
								create: _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_1$schema
							}
						},
						{
							name: "expectedRevision",
							wire: "expectedRevision",
							source: "json",
							acceptsUndefined: true,
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/replace:expectedRevision",
								create: _deepseek_ai_dsh_api_settings_controller_settings_replace_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-settings/types#SettingsNamespaceView",
						create: _deepseek_ai_dsh_api_settings_controller_settings_replace_result$schema
					},
					sourceLocation: {
						"file": "packages/api/settings-controller/src/index.ts",
						"line": 133,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-settings-controller#settings/update",
					service: "settingsController",
					namespace: "settings",
					method: "update",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "ns",
							wire: "ns",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/update:ns",
								create: _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_0$schema
							}
						},
						{
							name: "patch",
							wire: "patch",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/update:patch",
								create: _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_1$schema
							}
						},
						{
							name: "expectedRevision",
							wire: "expectedRevision",
							source: "json",
							acceptsUndefined: true,
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-settings-controller#settings/update:expectedRevision",
								create: _deepseek_ai_dsh_api_settings_controller_settings_update_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-settings/types#SettingsNamespaceView",
						create: _deepseek_ai_dsh_api_settings_controller_settings_update_result$schema
					},
					sourceLocation: {
						"file": "packages/api/settings-controller/src/index.ts",
						"line": 116,
						"column": 3
					}
				}
			]
		};
		//#endregion
		//#region ../../document/office-to-pdf/lib/typert.remote-client.js
		let _deepseek_ai_dsh_office_to_pdf_officeToPdf_generation_result$schema$value;
		const _deepseek_ai_dsh_office_to_pdf_officeToPdf_generation_result$schema = () => _deepseek_ai_dsh_office_to_pdf_officeToPdf_generation_result$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_0$schema$value;
		const _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_0$schema = () => _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_1$schema$value;
		const _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_1$schema = () => _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_2$schema$value;
		const _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_2$schema = () => _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_2$schema$value ??= union([literal("foreground"), literal("background")]);
		let _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_result$schema$value;
		const _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_result$schema = () => _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_result$schema$value ??= object({
			"missingFonts": array(string()).readonly(),
			"generation": intersection(string(), unknown()).readonly(),
			"offset": number().readonly(),
			"data": _instanceof(Uint8Array),
			"eof": boolean().readonly(),
			"absolutePath": string().readonly(),
			"version": string().readonly(),
			"bytes": number().readonly().optional()
		});
		const $resultSnapshot$1 = (input, path) => {
			if (input === null || typeof input !== "object" || input instanceof Uint8Array) return input;
			const toJSON = input.toJSON;
			const value = typeof toJSON === "function" ? toJSON.call(input, path.at(-1)?.toString() ?? "value") : input;
			if (value === null || typeof value !== "object" || value instanceof Uint8Array) return value;
			if (Array.isArray(value)) {
				const items = [];
				for (let index = 0, length = value.length; index < length; index++) items.push(value[index]);
				return items;
			}
			const fields = {};
			for (const key of Object.keys(value)) {
				const item = key === "toJSON" && value === input ? toJSON : value[key];
				if (key === "toJSON" && typeof item === "function") continue;
				Object.defineProperty(fields, key, {
					value: item,
					enumerable: true,
					writable: true,
					configurable: true
				});
			}
			return fields;
		};
		const $resultContainer$1 = (input, path, ancestors, project, snapshot) => {
			if (input === null || typeof input !== "object") return project(input);
			const owner = !ancestors.has(input);
			if (!owner && ancestors.get(input) !== path.length) throw new TypeError("Remote result contains a circular object");
			if (owner) ancestors.set(input, path.length);
			try {
				return project(snapshot ? $resultSnapshot$1(input, path) : input);
			} finally {
				if (owner) ancestors.delete(input);
			}
		};
		const $encode1$1 = (value, writeBytes, path, ancestors) => {
			return value instanceof Uint8Array ? writeBytes(value, path) : value;
		};
		const $encode0$1 = (value, writeBytes, path, ancestors) => {
			return $resultContainer$1(value, path, ancestors, (value) => {
				if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array) return value;
				if (Object.hasOwn(value, "data")) value["data"] = $encode1$1(value["data"], writeBytes, [...path, "data"], ancestors);
				return value;
			}, true);
		};
		const TYPERT_REMOTE$18 = {
			package: "@deepseek-ai/dsh-office-to-pdf",
			descriptors: [{
				id: "@deepseek-ai/dsh-office-to-pdf#officeToPdf/generation",
				service: "officeToPdf",
				namespace: "officeToPdf",
				method: "generation",
				implementation: "getGeneration",
				invocation: { kind: "direct" },
				parameters: [],
				cancellation: { parameter: "signal" },
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-office-to-pdf/types#OfficeToPdfGeneration",
					create: _deepseek_ai_dsh_office_to_pdf_officeToPdf_generation_result$schema
				},
				sourceLocation: {
					"file": "packages/document/office-to-pdf/src/index.ts",
					"line": 175,
					"column": 3
				}
			}, {
				id: "@deepseek-ai/dsh-office-to-pdf#officeToPdf/render",
				service: "officeToPdf",
				namespace: "officeToPdf",
				method: "render",
				invocation: { kind: "direct" },
				parameters: [
					{
						name: "workspaceFileScope",
						wire: "workspaceFileScopeId",
						source: "lookup",
						lookup: "workspaceFileScope",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_0$schema
						}
					},
					{
						name: "path",
						wire: "path",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-office-to-pdf#officeToPdf/render:path",
							create: _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_1$schema
						}
					},
					{
						name: "priority",
						wire: "priority",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-office-to-pdf/types#OfficeToPdfPriority",
							create: _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_parameter_2$schema
						}
					}
				],
				cancellation: { parameter: "signal" },
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-office-to-pdf/types#RenderedDocumentBytes",
					create: _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_result$schema,
					decode: (value) => _deepseek_ai_dsh_office_to_pdf_officeToPdf_render_result$schema().parse(value),
					encode: (value, writeBytes) => $encode0$1(value, writeBytes, [], /* @__PURE__ */ new Map())
				},
				sourceLocation: {
					"file": "packages/document/office-to-pdf/src/index.ts",
					"line": 160,
					"column": 9
				}
			}]
		};
		//#endregion
		//#region ../../goal/goal/lib/typert.remote-client.js
		let _deepseek_ai_dsh_goal_goals_clear_parameter_0$schema$value;
		const _deepseek_ai_dsh_goal_goals_clear_parameter_0$schema = () => _deepseek_ai_dsh_goal_goals_clear_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_goal_goals_clear_parameter_1$schema$value;
		const _deepseek_ai_dsh_goal_goals_clear_parameter_1$schema = () => _deepseek_ai_dsh_goal_goals_clear_parameter_1$schema$value ??= object({
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_clear_result$schema$value;
		const _deepseek_ai_dsh_goal_goals_clear_result$schema = () => _deepseek_ai_dsh_goal_goals_clear_result$schema$value ??= object({
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_complete_parameter_0$schema$value;
		const _deepseek_ai_dsh_goal_goals_complete_parameter_0$schema = () => _deepseek_ai_dsh_goal_goals_complete_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_goal_goals_complete_parameter_1$schema$value;
		const _deepseek_ai_dsh_goal_goals_complete_parameter_1$schema = () => _deepseek_ai_dsh_goal_goals_complete_parameter_1$schema$value ??= object({
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_complete_result$schema$value;
		const _deepseek_ai_dsh_goal_goals_complete_result$schema = () => _deepseek_ai_dsh_goal_goals_complete_result$schema$value ??= object({
			"roundsStarted": number().readonly(),
			"createdAt": number().readonly(),
			"updatedAt": number().readonly(),
			"activation": union([literal("armed"), literal("disarmed")]).readonly(),
			"objective": string().readonly(),
			"phase": union([
				literal("active"),
				literal("paused"),
				literal("blocked"),
				literal("complete")
			]).readonly(),
			"blockedReason": object({
				"code": string().readonly(),
				"message": string().readonly()
			}).readonly().optional(),
			"maxGoalRounds": number().readonly(),
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_create_parameter_0$schema$value;
		const _deepseek_ai_dsh_goal_goals_create_parameter_0$schema = () => _deepseek_ai_dsh_goal_goals_create_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_goal_goals_create_parameter_1$schema$value;
		const _deepseek_ai_dsh_goal_goals_create_parameter_1$schema = () => _deepseek_ai_dsh_goal_goals_create_parameter_1$schema$value ??= object({
			"objective": string().readonly(),
			"maxGoalRounds": number().readonly().optional()
		});
		let _deepseek_ai_dsh_goal_goals_create_result$schema$value;
		const _deepseek_ai_dsh_goal_goals_create_result$schema = () => _deepseek_ai_dsh_goal_goals_create_result$schema$value ??= object({ "ref": object({
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		}).readonly() });
		let _deepseek_ai_dsh_goal_goals_edit_parameter_0$schema$value;
		const _deepseek_ai_dsh_goal_goals_edit_parameter_0$schema = () => _deepseek_ai_dsh_goal_goals_edit_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_goal_goals_edit_parameter_1$schema$value;
		const _deepseek_ai_dsh_goal_goals_edit_parameter_1$schema = () => _deepseek_ai_dsh_goal_goals_edit_parameter_1$schema$value ??= object({
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_edit_parameter_2$schema$value;
		const _deepseek_ai_dsh_goal_goals_edit_parameter_2$schema = () => _deepseek_ai_dsh_goal_goals_edit_parameter_2$schema$value ??= object({
			"objective": string().readonly().optional(),
			"maxGoalRounds": number().readonly().optional()
		});
		let _deepseek_ai_dsh_goal_goals_edit_result$schema$value;
		const _deepseek_ai_dsh_goal_goals_edit_result$schema = () => _deepseek_ai_dsh_goal_goals_edit_result$schema$value ??= object({
			"roundsStarted": number().readonly(),
			"createdAt": number().readonly(),
			"updatedAt": number().readonly(),
			"activation": union([literal("armed"), literal("disarmed")]).readonly(),
			"objective": string().readonly(),
			"phase": union([
				literal("active"),
				literal("paused"),
				literal("blocked"),
				literal("complete")
			]).readonly(),
			"blockedReason": object({
				"code": string().readonly(),
				"message": string().readonly()
			}).readonly().optional(),
			"maxGoalRounds": number().readonly(),
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_get_parameter_0$schema$value;
		const _deepseek_ai_dsh_goal_goals_get_parameter_0$schema = () => _deepseek_ai_dsh_goal_goals_get_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_goal_goals_get_result$schema$value;
		const _deepseek_ai_dsh_goal_goals_get_result$schema = () => _deepseek_ai_dsh_goal_goals_get_result$schema$value ??= union([_undefined(), object({
			"roundsStarted": number().readonly(),
			"createdAt": number().readonly(),
			"updatedAt": number().readonly(),
			"activation": union([literal("armed"), literal("disarmed")]).readonly(),
			"objective": string().readonly(),
			"phase": union([
				literal("active"),
				literal("paused"),
				literal("blocked"),
				literal("complete")
			]).readonly(),
			"blockedReason": object({
				"code": string().readonly(),
				"message": string().readonly()
			}).readonly().optional(),
			"maxGoalRounds": number().readonly(),
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		})]);
		let _deepseek_ai_dsh_goal_goals_pause_parameter_0$schema$value;
		const _deepseek_ai_dsh_goal_goals_pause_parameter_0$schema = () => _deepseek_ai_dsh_goal_goals_pause_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_goal_goals_pause_parameter_1$schema$value;
		const _deepseek_ai_dsh_goal_goals_pause_parameter_1$schema = () => _deepseek_ai_dsh_goal_goals_pause_parameter_1$schema$value ??= object({
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_pause_result$schema$value;
		const _deepseek_ai_dsh_goal_goals_pause_result$schema = () => _deepseek_ai_dsh_goal_goals_pause_result$schema$value ??= object({
			"roundsStarted": number().readonly(),
			"createdAt": number().readonly(),
			"updatedAt": number().readonly(),
			"activation": union([literal("armed"), literal("disarmed")]).readonly(),
			"objective": string().readonly(),
			"phase": union([
				literal("active"),
				literal("paused"),
				literal("blocked"),
				literal("complete")
			]).readonly(),
			"blockedReason": object({
				"code": string().readonly(),
				"message": string().readonly()
			}).readonly().optional(),
			"maxGoalRounds": number().readonly(),
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_resume_parameter_0$schema$value;
		const _deepseek_ai_dsh_goal_goals_resume_parameter_0$schema = () => _deepseek_ai_dsh_goal_goals_resume_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_goal_goals_resume_parameter_1$schema$value;
		const _deepseek_ai_dsh_goal_goals_resume_parameter_1$schema = () => _deepseek_ai_dsh_goal_goals_resume_parameter_1$schema$value ??= object({
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		let _deepseek_ai_dsh_goal_goals_resume_result$schema$value;
		const _deepseek_ai_dsh_goal_goals_resume_result$schema = () => _deepseek_ai_dsh_goal_goals_resume_result$schema$value ??= object({
			"roundsStarted": number().readonly(),
			"createdAt": number().readonly(),
			"updatedAt": number().readonly(),
			"activation": union([literal("armed"), literal("disarmed")]).readonly(),
			"objective": string().readonly(),
			"phase": union([
				literal("active"),
				literal("paused"),
				literal("blocked"),
				literal("complete")
			]).readonly(),
			"blockedReason": object({
				"code": string().readonly(),
				"message": string().readonly()
			}).readonly().optional(),
			"maxGoalRounds": number().readonly(),
			"id": intersection(string(), unknown()).readonly(),
			"revision": number().readonly()
		});
		const TYPERT_REMOTE$17 = {
			package: "@deepseek-ai/dsh-goal",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-goal#goals/clear",
					service: "goals",
					namespace: "goals",
					method: "clear",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_goal_goals_clear_parameter_0$schema
						}
					}, {
						name: "ref",
						wire: "ref",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-goal/client#GoalRef",
							create: _deepseek_ai_dsh_goal_goals_clear_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-goal/client#GoalRef",
						create: _deepseek_ai_dsh_goal_goals_clear_result$schema
					},
					sourceLocation: {
						"file": "packages/goal/goal/src/index.ts",
						"line": 433,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-goal#goals/complete",
					service: "goals",
					namespace: "goals",
					method: "complete",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_goal_goals_complete_parameter_0$schema
						}
					}, {
						name: "ref",
						wire: "ref",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-goal/client#GoalRef",
							create: _deepseek_ai_dsh_goal_goals_complete_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-goal/client#GoalView",
						create: _deepseek_ai_dsh_goal_goals_complete_result$schema
					},
					sourceLocation: {
						"file": "packages/goal/goal/src/index.ts",
						"line": 391,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-goal#goals/create",
					service: "goals",
					namespace: "goals",
					method: "create",
					implementation: "remoteExportCreate",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_goal_goals_create_parameter_0$schema
						}
					}, {
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-goal/client#CreateGoalRequest",
							create: _deepseek_ai_dsh_goal_goals_create_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-goal/client#CreateGoalResult",
						create: _deepseek_ai_dsh_goal_goals_create_result$schema
					},
					sourceLocation: {
						"file": "packages/goal/goal/src/index.ts",
						"line": 647,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-goal#goals/edit",
					service: "goals",
					namespace: "goals",
					method: "edit",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_goal_goals_edit_parameter_0$schema
							}
						},
						{
							name: "ref",
							wire: "ref",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-goal/client#GoalRef",
								create: _deepseek_ai_dsh_goal_goals_edit_parameter_1$schema
							}
						},
						{
							name: "request",
							wire: "request",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-goal/client#EditGoalRequest",
								create: _deepseek_ai_dsh_goal_goals_edit_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-goal/client#GoalView",
						create: _deepseek_ai_dsh_goal_goals_edit_result$schema
					},
					sourceLocation: {
						"file": "packages/goal/goal/src/index.ts",
						"line": 329,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-goal#goals/get",
					service: "goals",
					namespace: "goals",
					method: "get",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_goal_goals_get_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-goal#goals/get:result",
						create: _deepseek_ai_dsh_goal_goals_get_result$schema
					},
					sourceLocation: {
						"file": "packages/goal/goal/src/index.ts",
						"line": 277,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-goal#goals/pause",
					service: "goals",
					namespace: "goals",
					method: "pause",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_goal_goals_pause_parameter_0$schema
						}
					}, {
						name: "ref",
						wire: "ref",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-goal/client#GoalRef",
							create: _deepseek_ai_dsh_goal_goals_pause_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-goal/client#GoalView",
						create: _deepseek_ai_dsh_goal_goals_pause_result$schema
					},
					sourceLocation: {
						"file": "packages/goal/goal/src/index.ts",
						"line": 352,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-goal#goals/resume",
					service: "goals",
					namespace: "goals",
					method: "resume",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_goal_goals_resume_parameter_0$schema
						}
					}, {
						name: "ref",
						wire: "ref",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-goal/client#GoalRef",
							create: _deepseek_ai_dsh_goal_goals_resume_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-goal/client#GoalView",
						create: _deepseek_ai_dsh_goal_goals_resume_result$schema
					},
					sourceLocation: {
						"file": "packages/goal/goal/src/index.ts",
						"line": 364,
						"column": 3
					}
				}
			]
		};
		//#endregion
		//#region ../../schedule/schedule/lib/typert.remote-client.js
		let _deepseek_ai_dsh_schedule_schedule_catalog_result$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_catalog_result$schema = () => _deepseek_ai_dsh_schedule_schedule_catalog_result$schema$value ??= array(union([
			intersection(object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("after").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"afterSeconds": number().readonly(),
				"scheduledAt": string().readonly()
			}), object({
				"sessionId": intersection(string(), unknown()).readonly(),
				"status": union([literal("active"), literal("inactive")]).readonly(),
				"lastDelivery": object({
					"scheduledAt": string().readonly(),
					"deliveredAt": string().readonly(),
					"messageId": intersection(string(), unknown()).readonly()
				}).readonly().optional()
			})),
			intersection(object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("at").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"scheduledAt": string().readonly()
			}), object({
				"sessionId": intersection(string(), unknown()).readonly(),
				"status": union([literal("active"), literal("inactive")]).readonly(),
				"lastDelivery": object({
					"scheduledAt": string().readonly(),
					"deliveredAt": string().readonly(),
					"messageId": intersection(string(), unknown()).readonly()
				}).readonly().optional()
			})),
			intersection(object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("every").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"everySeconds": number().readonly(),
				"scheduledAt": string().readonly()
			}), object({
				"sessionId": intersection(string(), unknown()).readonly(),
				"status": union([literal("active"), literal("inactive")]).readonly(),
				"lastDelivery": object({
					"scheduledAt": string().readonly(),
					"deliveredAt": string().readonly(),
					"messageId": intersection(string(), unknown()).readonly()
				}).readonly().optional()
			})),
			intersection(object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("daily").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"time": string().readonly(),
				"timeZone": string().readonly(),
				"scheduledAt": string().readonly()
			}), object({
				"sessionId": intersection(string(), unknown()).readonly(),
				"status": union([literal("active"), literal("inactive")]).readonly(),
				"lastDelivery": object({
					"scheduledAt": string().readonly(),
					"deliveredAt": string().readonly(),
					"messageId": intersection(string(), unknown()).readonly()
				}).readonly().optional()
			})),
			intersection(object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("weekly").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"time": string().readonly(),
				"timeZone": string().readonly(),
				"weekdays": array(number()).readonly(),
				"scheduledAt": string().readonly()
			}), object({
				"sessionId": intersection(string(), unknown()).readonly(),
				"status": union([literal("active"), literal("inactive")]).readonly(),
				"lastDelivery": object({
					"scheduledAt": string().readonly(),
					"deliveredAt": string().readonly(),
					"messageId": intersection(string(), unknown()).readonly()
				}).readonly().optional()
			})),
			intersection(object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("cron").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"expression": string().readonly(),
				"timeZone": string().readonly(),
				"scheduledAt": string().readonly()
			}), object({
				"sessionId": intersection(string(), unknown()).readonly(),
				"status": union([literal("active"), literal("inactive")]).readonly(),
				"lastDelivery": object({
					"scheduledAt": string().readonly(),
					"deliveredAt": string().readonly(),
					"messageId": intersection(string(), unknown()).readonly()
				}).readonly().optional()
			}))
		]));
		let _deepseek_ai_dsh_schedule_schedule_delete_parameter_0$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_delete_parameter_0$schema = () => _deepseek_ai_dsh_schedule_schedule_delete_parameter_0$schema$value ??= object({
			"id": intersection(string(), unknown()),
			"sessionId": intersection(string(), unknown())
		});
		let _deepseek_ai_dsh_schedule_schedule_delete_result$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_delete_result$schema = () => _deepseek_ai_dsh_schedule_schedule_delete_result$schema$value ??= union([object({
			"id": intersection(string(), unknown()).readonly(),
			"deleted": literal(true).readonly()
		}), object({
			"id": intersection(string(), unknown()).readonly(),
			"deleted": literal(false).readonly(),
			"code": literal("schedule_not_found").readonly()
		})]);
		let _deepseek_ai_dsh_schedule_schedule_history_parameter_0$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_history_parameter_0$schema = () => _deepseek_ai_dsh_schedule_schedule_history_parameter_0$schema$value ??= object({
			"limit": number(),
			"before": intersection(string(), unknown()).optional(),
			"id": intersection(string(), unknown()),
			"sessionId": intersection(string(), unknown())
		});
		let _deepseek_ai_dsh_schedule_schedule_history_result$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_history_result$schema = () => _deepseek_ai_dsh_schedule_schedule_history_result$schema$value ??= union([object({
			"id": intersection(string(), unknown()).readonly(),
			"records": array(object({
				"prompt": string().readonly().optional(),
				"scheduledAt": string().readonly(),
				"deliveredAt": string().readonly(),
				"messageId": intersection(string(), unknown()).readonly()
			})).readonly(),
			"earlierRecordsUnavailable": boolean().readonly(),
			"earlierRecordsPruned": boolean().readonly(),
			"retention": object({
				"days": number().readonly(),
				"records": number().readonly()
			}).readonly(),
			"nextBefore": intersection(string(), unknown()).readonly().optional()
		}), object({
			"id": intersection(string(), unknown()).readonly(),
			"code": union([literal("schedule_not_found"), literal("delivery_cursor_not_found")]).readonly()
		})]);
		let _deepseek_ai_dsh_schedule_schedule_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_list_parameter_0$schema = () => _deepseek_ai_dsh_schedule_schedule_list_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()) });
		let _deepseek_ai_dsh_schedule_schedule_list_result$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_list_result$schema = () => _deepseek_ai_dsh_schedule_schedule_list_result$schema$value ??= array(union([
			object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("after").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"afterSeconds": number().readonly(),
				"scheduledAt": string().readonly()
			}),
			object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("at").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"scheduledAt": string().readonly()
			}),
			object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("every").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"everySeconds": number().readonly(),
				"scheduledAt": string().readonly()
			}),
			object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("daily").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"time": string().readonly(),
				"timeZone": string().readonly(),
				"scheduledAt": string().readonly()
			}),
			object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("weekly").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"time": string().readonly(),
				"timeZone": string().readonly(),
				"weekdays": array(number()).readonly(),
				"scheduledAt": string().readonly()
			}),
			object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": literal("cron").readonly(),
				"title": string().readonly(),
				"prompt": string().readonly(),
				"expression": string().readonly(),
				"timeZone": string().readonly(),
				"scheduledAt": string().readonly()
			})
		]));
		let _deepseek_ai_dsh_schedule_schedule_update_parameter_0$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_update_parameter_0$schema = () => _deepseek_ai_dsh_schedule_schedule_update_parameter_0$schema$value ??= object({
			"expected": union([
				object({
					"id": intersection(string(), unknown()).readonly(),
					"kind": literal("after").readonly(),
					"title": string().readonly(),
					"prompt": string().readonly(),
					"afterSeconds": number().readonly(),
					"scheduledAt": string().readonly()
				}),
				object({
					"id": intersection(string(), unknown()).readonly(),
					"kind": literal("at").readonly(),
					"title": string().readonly(),
					"prompt": string().readonly(),
					"scheduledAt": string().readonly()
				}),
				object({
					"id": intersection(string(), unknown()).readonly(),
					"kind": literal("every").readonly(),
					"title": string().readonly(),
					"prompt": string().readonly(),
					"everySeconds": number().readonly(),
					"scheduledAt": string().readonly()
				}),
				object({
					"id": intersection(string(), unknown()).readonly(),
					"kind": literal("daily").readonly(),
					"title": string().readonly(),
					"prompt": string().readonly(),
					"time": string().readonly(),
					"timeZone": string().readonly(),
					"scheduledAt": string().readonly()
				}),
				object({
					"id": intersection(string(), unknown()).readonly(),
					"kind": literal("weekly").readonly(),
					"title": string().readonly(),
					"prompt": string().readonly(),
					"time": string().readonly(),
					"timeZone": string().readonly(),
					"weekdays": array(number()).readonly(),
					"scheduledAt": string().readonly()
				}),
				object({
					"id": intersection(string(), unknown()).readonly(),
					"kind": literal("cron").readonly(),
					"title": string().readonly(),
					"prompt": string().readonly(),
					"expression": string().readonly(),
					"timeZone": string().readonly(),
					"scheduledAt": string().readonly()
				})
			]).readonly(),
			"change": union([
				object({
					"kind": literal("at").readonly(),
					"at": union([string(), object({
						"date": string().readonly(),
						"time": string().readonly(),
						"time_zone": string().readonly()
					})]).readonly()
				}),
				object({
					"kind": literal("every").readonly(),
					"every_seconds": number().readonly()
				}),
				object({
					"kind": literal("daily").readonly(),
					"daily": object({
						"time": string().readonly(),
						"time_zone": string().readonly()
					}).readonly()
				}),
				object({
					"kind": literal("weekly").readonly(),
					"weekly": object({
						"time": string().readonly(),
						"time_zone": string().readonly(),
						"weekdays": array(number()).readonly()
					}).readonly()
				}),
				object({
					"kind": literal("cron").readonly(),
					"cron": object({
						"expression": string().readonly(),
						"time_zone": string().readonly()
					}).readonly()
				})
			]).readonly().optional(),
			"id": intersection(string(), unknown()),
			"sessionId": intersection(string(), unknown()),
			"title": string().readonly().optional(),
			"prompt": string().readonly().optional()
		});
		let _deepseek_ai_dsh_schedule_schedule_update_result$schema$value;
		const _deepseek_ai_dsh_schedule_schedule_update_result$schema = () => _deepseek_ai_dsh_schedule_schedule_update_result$schema$value ??= union([
			object({
				"id": intersection(string(), unknown()).readonly(),
				"updated": boolean().readonly(),
				"record": union([
					object({
						"id": intersection(string(), unknown()).readonly(),
						"kind": literal("after").readonly(),
						"title": string().readonly(),
						"prompt": string().readonly(),
						"afterSeconds": number().readonly(),
						"scheduledAt": string().readonly()
					}),
					object({
						"id": intersection(string(), unknown()).readonly(),
						"kind": literal("at").readonly(),
						"title": string().readonly(),
						"prompt": string().readonly(),
						"scheduledAt": string().readonly()
					}),
					object({
						"id": intersection(string(), unknown()).readonly(),
						"kind": literal("every").readonly(),
						"title": string().readonly(),
						"prompt": string().readonly(),
						"everySeconds": number().readonly(),
						"scheduledAt": string().readonly()
					}),
					object({
						"id": intersection(string(), unknown()).readonly(),
						"kind": literal("daily").readonly(),
						"title": string().readonly(),
						"prompt": string().readonly(),
						"time": string().readonly(),
						"timeZone": string().readonly(),
						"scheduledAt": string().readonly()
					}),
					object({
						"id": intersection(string(), unknown()).readonly(),
						"kind": literal("weekly").readonly(),
						"title": string().readonly(),
						"prompt": string().readonly(),
						"time": string().readonly(),
						"timeZone": string().readonly(),
						"weekdays": array(number()).readonly(),
						"scheduledAt": string().readonly()
					}),
					object({
						"id": intersection(string(), unknown()).readonly(),
						"kind": literal("cron").readonly(),
						"title": string().readonly(),
						"prompt": string().readonly(),
						"expression": string().readonly(),
						"timeZone": string().readonly(),
						"scheduledAt": string().readonly()
					})
				]).readonly()
			}),
			object({
				"id": intersection(string(), unknown()).readonly(),
				"updated": literal(false).readonly(),
				"code": union([
					literal("schedule_not_found"),
					literal("schedule_ended"),
					literal("schedule_conflict")
				]).readonly()
			}),
			object({
				"code": literal("invalid_prompt").readonly(),
				"message": string().readonly()
			}),
			object({
				"code": literal("invalid_selector").readonly(),
				"message": string().readonly()
			}),
			object({
				"code": literal("invalid_rule").readonly(),
				"message": string().readonly()
			}),
			object({
				"code": literal("invalid_time_zone").readonly(),
				"message": string().readonly()
			}),
			object({
				"code": literal("not_future").readonly(),
				"message": string().readonly()
			}),
			object({
				"code": literal("time_out_of_range").readonly(),
				"message": string().readonly()
			}),
			object({
				"code": literal("frequency_too_high").readonly(),
				"message": string().readonly()
			}),
			object({
				"code": literal("subagent_session").readonly(),
				"message": string().readonly()
			}),
			object({
				"code": literal("internal_error").readonly(),
				"message": string().readonly()
			})
		]);
		const TYPERT_REMOTE$16 = {
			package: "@deepseek-ai/dsh-schedule",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-schedule#schedule/catalog",
					service: "schedule",
					namespace: "schedule",
					method: "catalog",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-schedule#schedule/catalog:result",
						create: _deepseek_ai_dsh_schedule_schedule_catalog_result$schema
					},
					sourceLocation: {
						"file": "packages/schedule/schedule/src/index.ts",
						"line": 285,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-schedule#schedule/delete",
					service: "schedule",
					namespace: "schedule",
					method: "delete",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-schedule/client#ScheduleDeleteRequest",
							create: _deepseek_ai_dsh_schedule_schedule_delete_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-schedule/client#ScheduleDeleteResult",
						create: _deepseek_ai_dsh_schedule_schedule_delete_result$schema
					},
					sourceLocation: {
						"file": "packages/schedule/schedule/src/index.ts",
						"line": 326,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-schedule#schedule/history",
					service: "schedule",
					namespace: "schedule",
					method: "history",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-schedule/client#ScheduleDeliveryHistoryRequest",
							create: _deepseek_ai_dsh_schedule_schedule_history_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-schedule/client#ScheduleDeliveryHistoryResult",
						create: _deepseek_ai_dsh_schedule_schedule_history_result$schema
					},
					sourceLocation: {
						"file": "packages/schedule/schedule/src/index.ts",
						"line": 303,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-schedule#schedule/list",
					service: "schedule",
					namespace: "schedule",
					method: "list",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-schedule/client#ScheduleListRequest",
							create: _deepseek_ai_dsh_schedule_schedule_list_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-schedule#schedule/list:result",
						create: _deepseek_ai_dsh_schedule_schedule_list_result$schema
					},
					sourceLocation: {
						"file": "packages/schedule/schedule/src/index.ts",
						"line": 271,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-schedule#schedule/update",
					service: "schedule",
					namespace: "schedule",
					method: "update",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-schedule/client#ScheduleUpdateRequest",
							create: _deepseek_ai_dsh_schedule_schedule_update_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-schedule/client#ScheduleUpdateResult",
						create: _deepseek_ai_dsh_schedule_schedule_update_result$schema
					},
					sourceLocation: {
						"file": "packages/schedule/schedule/src/index.ts",
						"line": 356,
						"column": 9
					}
				}
			]
		};
		//#endregion
		//#region ../../llm/llm/lib/typert.remote-client.js
		let _deepseek_ai_dsh_llm_llm_discoverModels_parameter_0$schema$value;
		const _deepseek_ai_dsh_llm_llm_discoverModels_parameter_0$schema = () => _deepseek_ai_dsh_llm_llm_discoverModels_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_llm_llm_discoverModels_parameter_1$schema$value;
		const _deepseek_ai_dsh_llm_llm_discoverModels_parameter_1$schema = () => _deepseek_ai_dsh_llm_llm_discoverModels_parameter_1$schema$value ??= object({
			"provider": string().optional(),
			"baseURL": string().optional(),
			"api": string().optional(),
			"apiKey": string().optional()
		});
		let _deepseek_ai_dsh_llm_llm_discoverModels_result$schema$value;
		const _deepseek_ai_dsh_llm_llm_discoverModels_result$schema = () => _deepseek_ai_dsh_llm_llm_discoverModels_result$schema$value ??= array(object({
			"id": string(),
			"name": string().optional(),
			"contextWindow": number().optional(),
			"maxTokens": number().optional(),
			"inputModalities": array(union([literal("text"), literal("image")])).optional()
		}));
		let _deepseek_ai_dsh_llm_llm_listConfigurableProviders_result$schema$value;
		const _deepseek_ai_dsh_llm_llm_listConfigurableProviders_result$schema = () => _deepseek_ai_dsh_llm_llm_listConfigurableProviders_result$schema$value ??= array(object({
			"provider": string(),
			"displayName": string(),
			"settingsNs": string(),
			"settingsPath": array(string()),
			"declared": boolean().optional(),
			"error": string().optional()
		}));
		let _deepseek_ai_dsh_llm_llm_listProviders_result$schema$value;
		const _deepseek_ai_dsh_llm_llm_listProviders_result$schema = () => _deepseek_ai_dsh_llm_llm_listProviders_result$schema$value ??= array(object({
			"id": string(),
			"name": string()
		}));
		const TYPERT_REMOTE$15 = {
			package: "@deepseek-ai/dsh-llm",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-llm#llm/discoverModels",
					service: "llm",
					namespace: "llm",
					method: "discoverModels",
					implementation: "remoteDiscoverModels",
					invocation: { kind: "direct" },
					parameters: [{
						name: "settingsNs",
						wire: "settingsNs",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-llm#llm/discoverModels:settingsNs",
							create: _deepseek_ai_dsh_llm_llm_discoverModels_parameter_0$schema
						}
					}, {
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-llm/types#LlmModelDiscoveryRequest",
							create: _deepseek_ai_dsh_llm_llm_discoverModels_parameter_1$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-llm#llm/discoverModels:result",
						create: _deepseek_ai_dsh_llm_llm_discoverModels_result$schema
					},
					sourceLocation: {
						"file": "packages/llm/llm/src/index.ts",
						"line": 631,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-llm#llm/listConfigurableProviders",
					service: "llm",
					namespace: "llm",
					method: "listConfigurableProviders",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-llm#llm/listConfigurableProviders:result",
						create: _deepseek_ai_dsh_llm_llm_listConfigurableProviders_result$schema
					},
					sourceLocation: {
						"file": "packages/llm/llm/src/index.ts",
						"line": 543,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-llm#llm/listProviders",
					service: "llm",
					namespace: "llm",
					method: "listProviders",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-llm#llm/listProviders:result",
						create: _deepseek_ai_dsh_llm_llm_listProviders_result$schema
					},
					sourceLocation: {
						"file": "packages/llm/llm/src/index.ts",
						"line": 471,
						"column": 3
					}
				}
			]
		};
		//#endregion
		//#region ../../extensions/cordis-host-runner/lib/typert.remote-client.js
		let JsonValueRemoteCodec$schema$value$1;
		const JsonValueRemoteCodec$schema$1 = () => JsonValueRemoteCodec$schema$value$1 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema$1())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema$1()))
		]);
		let JsonValueRemoteCodec$schema2$value$1;
		const JsonValueRemoteCodec$schema2$1 = () => JsonValueRemoteCodec$schema2$value$1 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema2$1())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema2$1()))
		]);
		let JsonValueRemoteCodec$schema3$value$1;
		const JsonValueRemoteCodec$schema3$1 = () => JsonValueRemoteCodec$schema3$value$1 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema3$1())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema3$1()))
		]);
		let JsonValueRemoteCodec$schema4$value$1;
		const JsonValueRemoteCodec$schema4$1 = () => JsonValueRemoteCodec$schema4$value$1 ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema4$1())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema4$1()))
		]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_2$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_2$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_2$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_result$schema$value ??= object({
			"code": string(),
			"name": string(),
			"pluginId": intersection(string(), unknown()),
			"packageId": intersection(string(), unknown()),
			"pluginRunId": intersection(string(), unknown())
		});
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_inventory_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_inventory_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_inventory_result$schema$value ??= array(object({
			"pluginId": intersection(string(), unknown()),
			"agentId": intersection(string(), unknown()),
			"packages": array(object({
				"packageId": intersection(string(), unknown()),
				"name": string(),
				"purpose": string(),
				"hasHostHalf": boolean(),
				"hasClientHalf": boolean()
			})),
			"currentPackageId": intersection(string(), unknown()).optional(),
			"nextPackageId": intersection(string(), unknown()).optional(),
			"activeRun": object({
				"pluginRunId": intersection(string(), unknown()),
				"packageId": intersection(string(), unknown())
			}).optional(),
			"latestRun": object({
				"pluginRunId": intersection(string(), unknown()),
				"packageId": intersection(string(), unknown()),
				"mode": union([literal("run"), literal("update")]),
				"status": union([
					literal("cancelled"),
					literal("failed"),
					literal("running"),
					literal("rejected"),
					literal("awaiting-approval"),
					literal("starting-host"),
					literal("client-pending"),
					literal("waiting"),
					literal("stopped")
				]),
				"approvalRequestId": intersection(string(), unknown()).optional(),
				"requiresApproval": boolean().optional(),
				"host": object({
					"status": union([
						literal("failed"),
						literal("running"),
						literal("pending"),
						literal("waiting"),
						literal("stopped"),
						literal("absent")
					]),
					"waitingFor": array(string()),
					"error": string().optional()
				}),
				"client": object({
					"status": union([
						literal("failed"),
						literal("running"),
						literal("pending"),
						literal("waiting"),
						literal("stopped"),
						literal("absent")
					]),
					"waitingFor": array(string()),
					"error": string().optional()
				}),
				"error": object({
					"phase": union([
						literal("approval"),
						literal("host-load"),
						literal("host-apply"),
						literal("client-load"),
						literal("client-apply"),
						literal("client-render")
					]),
					"message": string(),
					"stack": string().optional(),
					"pluginId": intersection(string(), unknown()),
					"packageId": intersection(string(), unknown()),
					"pluginRunId": intersection(string(), unknown())
				}).optional()
			}).optional()
		}));
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_2$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_2$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_2$schema$value ??= string();
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_3$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_3$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_3$schema$value ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema3$1())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema3$1()))
		]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_result$schema$value ??= union([object({
			"ok": literal(true),
			"value": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema4$1())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema4$1()))
			])
		}), intersection(object({
			"ok": literal(false),
			"code": union([
				literal("plugin-not-running"),
				literal("stale-run"),
				literal("method-not-found"),
				literal("handler-error")
			])
		}), object({
			"message": string(),
			"stack": string().optional()
		}))]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_2$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_2$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_2$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_3$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_3$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_3$schema$value ??= object({
			"message": string(),
			"stack": string().optional()
		});
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_result$schema$value ??= literal(null);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_2$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_2$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_2$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_3$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_3$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_3$schema$value ??= object({
			"slot": string(),
			"message": string(),
			"stack": string().optional(),
			"abdicated": boolean()
		});
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_result$schema$value ??= literal(null);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_2$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_2$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_2$schema$value ??= union([object({
			"ok": literal(true),
			"data": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema2$1())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema2$1()))
			])
		}), object({
			"ok": literal(false),
			"reason": union([
				literal("cancelled"),
				literal("provider-missing"),
				literal("method-missing"),
				literal("invalid-input"),
				literal("provider-error")
			]),
			"message": string()
		})]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_result$schema$value ??= object({ "accepted": boolean() });
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_parameter_1$schema$value ??= union([object({
			"ok": literal(true),
			"pluginRunId": intersection(string(), unknown()),
			"waitingFor": array(string()).optional()
		}), object({
			"ok": literal(false),
			"reason": union([
				literal("rejected"),
				literal("host-half-failed"),
				literal("client-half-failed")
			]),
			"pluginRunId": intersection(string(), unknown()).optional(),
			"startedHere": boolean().optional(),
			"message": string().optional(),
			"stack": string().optional()
		})]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_result$schema$value ??= object({ "accepted": boolean() });
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_2$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_2$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_2$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_3$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_3$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_3$schema$value ??= union([literal("run"), literal("update")]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_4$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_4$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_4$schema$value ??= union([literal(null), intersection(string(), unknown())]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_5$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_5$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_5$schema$value ??= boolean();
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_result$schema$value ??= union([object({
			"ok": literal(true),
			"pluginId": intersection(string(), unknown()),
			"packageId": intersection(string(), unknown()),
			"pluginRunId": intersection(string(), unknown()),
			"waitingFor": array(string()),
			"startedHere": boolean()
		}), intersection(object({ "ok": literal(false) }), object({
			"message": string(),
			"stack": string().optional()
		}))]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_2$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_2$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_2$schema$value ??= union([object({
			"ok": literal(true),
			"pluginRunId": intersection(string(), unknown()),
			"waitingFor": array(string()).optional()
		}), object({
			"ok": literal(false),
			"reason": union([
				literal("rejected"),
				literal("host-half-failed"),
				literal("client-half-failed")
			]),
			"pluginRunId": intersection(string(), unknown()).optional(),
			"startedHere": boolean().optional(),
			"message": string().optional(),
			"stack": string().optional()
		})]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_result$schema$value ??= union([object({
			"ok": literal(true),
			"status": union([
				literal("running"),
				literal("awaiting-approval"),
				literal("starting")
			]),
			"pluginId": intersection(string(), unknown()),
			"packageId": intersection(string(), unknown()),
			"pluginRunId": intersection(string(), unknown()),
			"waitingFor": array(string()),
			"clientWaitingFor": array(string()).optional(),
			"currentPackageId": intersection(string(), unknown()).optional(),
			"nextPackageId": intersection(string(), unknown()).optional(),
			"mode": union([literal("run"), literal("update")])
		}), object({
			"ok": literal(false),
			"reason": union([
				literal("cancelled"),
				literal("plugin-missing"),
				literal("rejected"),
				literal("host-half-failed"),
				literal("client-half-failed"),
				literal("package-missing"),
				literal("invalid-mode"),
				literal("transition-in-flight"),
				literal("not-running")
			]),
			"message": string(),
			"stack": string().optional()
		})]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_result$schema$value ??= union([object({ "ok": literal(true) }), object({
			"ok": literal(false),
			"reason": union([literal("plugin-missing"), literal("not-running")]),
			"message": string()
		})]);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_syncInspectManifest_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_syncInspectManifest_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_syncInspectManifest_parameter_0$schema$value ??= array(object({
			"id": string(),
			"description": string(),
			"methods": array(object({
				"name": string(),
				"description": string(),
				"inputSchema": union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema$1())),
					record(string(), lazy(() => JsonValueRemoteCodec$schema$1()))
				]),
				"outputSchema": union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema$1())),
					record(string(), lazy(() => JsonValueRemoteCodec$schema$1()))
				])
			}))
		}));
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_syncInspectManifest_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_syncInspectManifest_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_syncInspectManifest_result$schema$value ??= literal(null);
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_parameter_0$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_parameter_0$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_parameter_1$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_parameter_1$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_result$schema$value;
		const _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_result$schema = () => _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_result$schema$value ??= union([object({
			"ok": literal(true),
			"wasRunning": boolean()
		}), object({
			"ok": literal(false),
			"reason": literal("plugin-missing"),
			"message": string()
		})]);
		const TYPERT_REMOTE$14 = {
			package: "@deepseek-ai/dsh-cordis-host-runner",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/getClientCode",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "getClientCode",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_0$schema
							}
						},
						{
							name: "pluginId",
							wire: "pluginId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_1$schema
							}
						},
						{
							name: "pluginRunId",
							wire: "pluginRunId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginRunId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisClientSource",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_getClientCode_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 392,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/inventory",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "inventory",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/inventory:result",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_inventory_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 534,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/invoke",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "invoke",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "pluginId",
							wire: "pluginId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_0$schema
							}
						},
						{
							name: "pluginRunId",
							wire: "pluginRunId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginRunId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_1$schema
							}
						},
						{
							name: "method",
							wire: "method",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/invoke:method",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_2$schema
							}
						},
						{
							name: "args",
							wire: "args",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-util-values#JsonValue",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_parameter_3$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisInvokeResult",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_invoke_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 750,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/reportClientGuardFailure",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "reportClientGuardFailure",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_0$schema
							}
						},
						{
							name: "pluginId",
							wire: "pluginId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_1$schema
							}
						},
						{
							name: "pluginRunId",
							wire: "pluginRunId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginRunId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_2$schema
							}
						},
						{
							name: "failure",
							wire: "failure",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisErrorDetails",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_parameter_3$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/reportClientGuardFailure:result",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportClientGuardFailure_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 727,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/reportRenderFailure",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "reportRenderFailure",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_0$schema
							}
						},
						{
							name: "pluginId",
							wire: "pluginId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_1$schema
							}
						},
						{
							name: "pluginRunId",
							wire: "pluginRunId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginRunId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_2$schema
							}
						},
						{
							name: "failure",
							wire: "failure",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisRenderFailure",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_parameter_3$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/reportRenderFailure:result",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_reportRenderFailure_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 693,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/resolveInspectQuery",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "resolveInspectQuery",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_0$schema
							}
						},
						{
							name: "requestId",
							wire: "requestId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisInspectRequestId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_1$schema
							}
						},
						{
							name: "resolution",
							wire: "resolution",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisInspectQueryResolution",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisInspectResolveAck",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveInspectQuery_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 520,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/resolveRequestRun",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "resolveRequestRun",
					invocation: { kind: "direct" },
					parameters: [{
						name: "requestId",
						wire: "requestId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#ApprovalRequestId",
							create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_parameter_0$schema
						}
					}, {
						name: "resolution",
						wire: "resolution",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisRunResolution",
							create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisResolveAck",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_resolveRequestRun_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 421,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/runHostHalf",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "runHostHalf",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_0$schema
							}
						},
						{
							name: "pluginId",
							wire: "pluginId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_1$schema
							}
						},
						{
							name: "packageId",
							wire: "packageId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPackageId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_2$schema
							}
						},
						{
							name: "mode",
							wire: "mode",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicRunMode",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_3$schema
							}
						},
						{
							name: "requestId",
							wire: "requestId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/runHostHalf:requestId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_4$schema
							}
						},
						{
							name: "approveFutureVersions",
							wire: "approveFutureVersions",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/runHostHalf:approveFutureVersions",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_parameter_5$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisHostHalfResult",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_runHostHalf_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 333,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/settleUserRun",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "settleUserRun",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_0$schema
							}
						},
						{
							name: "pluginId",
							wire: "pluginId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginId",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_1$schema
							}
						},
						{
							name: "resolution",
							wire: "resolution",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisRunResolution",
								create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisRunResponse",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_settleUserRun_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 446,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/stopFromPanel",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "stopFromPanel",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_parameter_0$schema
						}
					}, {
						name: "pluginId",
						wire: "pluginId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginId",
							create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisStopResponse",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_stopFromPanel_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 488,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/syncInspectManifest",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "syncInspectManifest",
					invocation: { kind: "direct" },
					parameters: [{
						name: "providers",
						wire: "providers",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/syncInspectManifest:providers",
							create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_syncInspectManifest_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/syncInspectManifest:result",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_syncInspectManifest_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 506,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-cordis-host-runner#dynamicCordisRunner/undefineFromPanel",
					service: "dynamicCordisRunner",
					namespace: "dynamicCordisRunner",
					method: "undefineFromPanel",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_parameter_0$schema
						}
					}, {
						name: "pluginId",
						wire: "pluginId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#CordisDynamicPluginId",
							create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-cordis-host-runner/types#DynamicCordisUndefineReceipt",
						create: _deepseek_ai_dsh_cordis_host_runner_dynamicCordisRunner_undefineFromPanel_result$schema
					},
					sourceLocation: {
						"file": "packages/extensions/cordis-host-runner/src/index.ts",
						"line": 235,
						"column": 9
					}
				}
			]
		};
		//#endregion
		//#region ../../boot/plugin-manager/lib/typert.remote-client.js
		let _deepseek_ai_dsh_plugin_manager_pluginManager_cancelInstall_parameter_0$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_cancelInstall_parameter_0$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_cancelInstall_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_plugin_manager_pluginManager_cancelInstall_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_cancelInstall_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_cancelInstall_result$schema$value ??= object({ "status": union([
			literal("cancelled"),
			literal("not-running"),
			literal("too-late")
		]).readonly() });
		let _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_parameter_0$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_parameter_0$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_parameter_1$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_parameter_1$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_parameter_1$schema$value ??= union([_undefined(), object({ "registry": union([literal(null), string()]).readonly().optional() })]);
		let _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_result$schema$value ??= union([object({
			"status": literal("accepted").readonly(),
			"kind": union([
				literal("registry"),
				literal("path"),
				literal("git"),
				literal("tarball")
			]).readonly(),
			"name": string().readonly().optional(),
			"version": string().readonly().optional(),
			"description": string().readonly().optional(),
			"bundle": union([
				literal(null),
				literal(false),
				literal(true)
			]).readonly(),
			"registry": union([literal(null), string()]).readonly(),
			"host": string().readonly().optional()
		}), object({
			"status": literal("refused").readonly(),
			"problem": union([
				literal("network"),
				literal("unknown"),
				literal("invalid-spec"),
				literal("not-found"),
				literal("already-installed"),
				literal("not-a-package"),
				literal("not-a-bundle")
			]).readonly(),
			"reason": string().readonly(),
			"registries": array(union([literal(null), string()])).readonly().optional()
		})]);
		let _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_parameter_0$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_parameter_0$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_parameter_1$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_parameter_1$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_parameter_1$schema$value ??= union([_undefined(), object({
			"enabled": boolean().optional(),
			"requestId": intersection(string(), unknown()).optional(),
			"approvedBuilds": array(string()).optional(),
			"registry": union([literal(null), string()]).optional()
		})]);
		let _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_result$schema$value ??= object({
			"changed": boolean(),
			"application": union([
				literal("cancelled"),
				literal("failed"),
				literal("applied"),
				literal("restart-required"),
				literal("overridden")
			]),
			"stage": union([
				literal("remove"),
				literal("install"),
				literal("enable")
			]),
			"target": string(),
			"enabled": boolean().optional(),
			"error": object({
				"code": union([
					literal("management-required"),
					literal("unaddressable"),
					literal("unknown-plugin"),
					literal("invalid-spec"),
					literal("ambiguous-install"),
					literal("not-bundle"),
					literal("not-removable"),
					literal("stop-profile"),
					literal("bundle-in-use"),
					literal("stale-approval"),
					literal("incompatible-version"),
					literal("operation-error")
				]),
				"diagnostic": string().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"warnings": array(string()).optional(),
			"packageResult": object({
				"exitCode": number(),
				"output": string(),
				"truncated": boolean(),
				"logPath": string(),
				"kind": union([
					literal("network"),
					literal("unknown"),
					literal("timeout"),
					literal("integrity"),
					literal("pnpm-missing"),
					literal("not-found"),
					literal("no-matching-version"),
					literal("disk-full"),
					literal("permission"),
					literal("build-blocked")
				]).optional(),
				"timedOut": boolean().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"bundle": string().optional(),
			"version": string().optional(),
			"pendingBuilds": array(string()).optional(),
			"approvedBuilds": array(string()).optional(),
			"registries": array(union([literal(null), string()])).optional(),
			"failedAt": union([literal("registry"), literal("spec-host")]).optional()
		});
		let _deepseek_ai_dsh_plugin_manager_pluginManager_listBundles_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_listBundles_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_listBundles_result$schema$value ??= array(object({
			"name": string(),
			"version": string().optional(),
			"meta": object({
				"title": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
				"description": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
				"icon": string().readonly().optional(),
				"error": string().readonly().optional()
			}).optional(),
			"description": string().optional(),
			"enabled": boolean(),
			"installed": boolean(),
			"source": string().optional(),
			"optional": boolean(),
			"removable": boolean(),
			"readOnlyReason": union([literal("management-required"), literal("unaddressable")]).optional(),
			"error": object({
				"code": union([
					literal("management-required"),
					literal("unaddressable"),
					literal("unknown-plugin"),
					literal("invalid-spec"),
					literal("ambiguous-install"),
					literal("not-bundle"),
					literal("not-removable"),
					literal("stop-profile"),
					literal("bundle-in-use"),
					literal("stale-approval"),
					literal("incompatible-version"),
					literal("operation-error")
				]),
				"diagnostic": string().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"rows": array(object({
				"rowId": string(),
				"moduleName": string(),
				"meta": object({
					"title": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
					"description": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
					"icon": string().readonly().optional(),
					"error": string().readonly().optional()
				}).optional(),
				"entryId": intersection(string(), unknown()).optional()
			})),
			"overrides": array(string())
		}));
		let _deepseek_ai_dsh_plugin_manager_pluginManager_listPlugins_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_listPlugins_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_listPlugins_result$schema$value ??= array(union([intersection(object({
			"entryId": intersection(string(), unknown()).readonly(),
			"moduleName": string().readonly(),
			"meta": object({
				"title": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
				"description": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
				"icon": string().readonly().optional(),
				"error": string().readonly().optional()
			}).readonly().optional(),
			"enabled": boolean().readonly(),
			"fiberPhase": union([
				literal(null),
				literal("failed"),
				literal("pending"),
				literal("active"),
				literal("loading"),
				literal("unloading")
			]).readonly()
		}), object({
			"patchId": string(),
			"readOnlyReason": never().optional()
		})), intersection(object({
			"entryId": intersection(string(), unknown()).readonly(),
			"moduleName": string().readonly(),
			"meta": object({
				"title": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
				"description": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
				"icon": string().readonly().optional(),
				"error": string().readonly().optional()
			}).readonly().optional(),
			"enabled": boolean().readonly(),
			"fiberPhase": union([
				literal(null),
				literal("failed"),
				literal("pending"),
				literal("active"),
				literal("loading"),
				literal("unloading")
			]).readonly()
		}), object({
			"patchId": never().optional(),
			"readOnlyReason": union([literal("management-required"), literal("unaddressable")])
		}))]));
		let _deepseek_ai_dsh_plugin_manager_pluginManager_listVersionExemptions_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_listVersionExemptions_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_listVersionExemptions_result$schema$value ??= object({
			"exemptions": record(string(), array(string())),
			"warnings": array(string())
		});
		let _deepseek_ai_dsh_plugin_manager_pluginManager_registries_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_registries_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_registries_result$schema$value ??= object({
			"registry": union([literal(null), string()]).readonly(),
			"fallbackRegistries": array(string()).readonly(),
			"resolved": union([literal(null), string()]).readonly()
		});
		let _deepseek_ai_dsh_plugin_manager_pluginManager_removeBundle_parameter_0$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_removeBundle_parameter_0$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_removeBundle_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_removeBundle_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_removeBundle_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_removeBundle_result$schema$value ??= object({
			"changed": boolean(),
			"application": union([
				literal("cancelled"),
				literal("failed"),
				literal("applied"),
				literal("restart-required"),
				literal("overridden")
			]),
			"stage": union([
				literal("remove"),
				literal("install"),
				literal("enable")
			]),
			"target": string(),
			"enabled": boolean().optional(),
			"error": object({
				"code": union([
					literal("management-required"),
					literal("unaddressable"),
					literal("unknown-plugin"),
					literal("invalid-spec"),
					literal("ambiguous-install"),
					literal("not-bundle"),
					literal("not-removable"),
					literal("stop-profile"),
					literal("bundle-in-use"),
					literal("stale-approval"),
					literal("incompatible-version"),
					literal("operation-error")
				]),
				"diagnostic": string().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"warnings": array(string()).optional(),
			"packageResult": object({
				"exitCode": number(),
				"output": string(),
				"truncated": boolean(),
				"logPath": string(),
				"kind": union([
					literal("network"),
					literal("unknown"),
					literal("timeout"),
					literal("integrity"),
					literal("pnpm-missing"),
					literal("not-found"),
					literal("no-matching-version"),
					literal("disk-full"),
					literal("permission"),
					literal("build-blocked")
				]).optional(),
				"timedOut": boolean().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"bundle": string().optional(),
			"version": string().optional(),
			"pendingBuilds": array(string()).optional(),
			"approvedBuilds": array(string()).optional(),
			"registries": array(union([literal(null), string()])).optional(),
			"failedAt": union([literal("registry"), literal("spec-host")]).optional()
		});
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_parameter_0$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_parameter_0$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_parameter_1$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_parameter_1$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_parameter_1$schema$value ??= boolean();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_result$schema$value ??= object({
			"changed": boolean(),
			"application": union([
				literal("cancelled"),
				literal("failed"),
				literal("applied"),
				literal("restart-required"),
				literal("overridden")
			]),
			"stage": union([
				literal("remove"),
				literal("install"),
				literal("enable")
			]),
			"target": string(),
			"enabled": boolean().optional(),
			"error": object({
				"code": union([
					literal("management-required"),
					literal("unaddressable"),
					literal("unknown-plugin"),
					literal("invalid-spec"),
					literal("ambiguous-install"),
					literal("not-bundle"),
					literal("not-removable"),
					literal("stop-profile"),
					literal("bundle-in-use"),
					literal("stale-approval"),
					literal("incompatible-version"),
					literal("operation-error")
				]),
				"diagnostic": string().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"warnings": array(string()).optional(),
			"packageResult": object({
				"exitCode": number(),
				"output": string(),
				"truncated": boolean(),
				"logPath": string(),
				"kind": union([
					literal("network"),
					literal("unknown"),
					literal("timeout"),
					literal("integrity"),
					literal("pnpm-missing"),
					literal("not-found"),
					literal("no-matching-version"),
					literal("disk-full"),
					literal("permission"),
					literal("build-blocked")
				]).optional(),
				"timedOut": boolean().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"bundle": string().optional(),
			"version": string().optional(),
			"pendingBuilds": array(string()).optional(),
			"approvedBuilds": array(string()).optional(),
			"registries": array(union([literal(null), string()])).optional(),
			"failedAt": union([literal("registry"), literal("spec-host")]).optional()
		});
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_parameter_0$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_parameter_0$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_parameter_1$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_parameter_1$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_parameter_1$schema$value ??= boolean();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_result$schema$value ??= object({
			"changed": boolean(),
			"application": union([
				literal("cancelled"),
				literal("failed"),
				literal("applied"),
				literal("restart-required"),
				literal("overridden")
			]),
			"stage": union([
				literal("remove"),
				literal("install"),
				literal("enable")
			]),
			"target": string(),
			"enabled": boolean().optional(),
			"error": object({
				"code": union([
					literal("management-required"),
					literal("unaddressable"),
					literal("unknown-plugin"),
					literal("invalid-spec"),
					literal("ambiguous-install"),
					literal("not-bundle"),
					literal("not-removable"),
					literal("stop-profile"),
					literal("bundle-in-use"),
					literal("stale-approval"),
					literal("incompatible-version"),
					literal("operation-error")
				]),
				"diagnostic": string().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"warnings": array(string()).optional(),
			"packageResult": object({
				"exitCode": number(),
				"output": string(),
				"truncated": boolean(),
				"logPath": string(),
				"kind": union([
					literal("network"),
					literal("unknown"),
					literal("timeout"),
					literal("integrity"),
					literal("pnpm-missing"),
					literal("not-found"),
					literal("no-matching-version"),
					literal("disk-full"),
					literal("permission"),
					literal("build-blocked")
				]).optional(),
				"timedOut": boolean().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"bundle": string().optional(),
			"version": string().optional(),
			"pendingBuilds": array(string()).optional(),
			"approvedBuilds": array(string()).optional(),
			"registries": array(union([literal(null), string()])).optional(),
			"failedAt": union([literal("registry"), literal("spec-host")]).optional()
		});
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_0$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_0$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_1$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_1$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_2$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_2$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_2$schema$value ??= boolean();
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_3$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_3$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_3$schema$value ??= union([
			_undefined(),
			literal(false),
			literal(true)
		]);
		let _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_result$schema$value ??= object({
			"changed": boolean(),
			"application": union([
				literal("cancelled"),
				literal("failed"),
				literal("applied"),
				literal("restart-required"),
				literal("overridden")
			]),
			"stage": union([
				literal("remove"),
				literal("install"),
				literal("enable")
			]),
			"target": string(),
			"enabled": boolean().optional(),
			"error": object({
				"code": union([
					literal("management-required"),
					literal("unaddressable"),
					literal("unknown-plugin"),
					literal("invalid-spec"),
					literal("ambiguous-install"),
					literal("not-bundle"),
					literal("not-removable"),
					literal("stop-profile"),
					literal("bundle-in-use"),
					literal("stale-approval"),
					literal("incompatible-version"),
					literal("operation-error")
				]),
				"diagnostic": string().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"warnings": array(string()).optional(),
			"packageResult": object({
				"exitCode": number(),
				"output": string(),
				"truncated": boolean(),
				"logPath": string(),
				"kind": union([
					literal("network"),
					literal("unknown"),
					literal("timeout"),
					literal("integrity"),
					literal("pnpm-missing"),
					literal("not-found"),
					literal("no-matching-version"),
					literal("disk-full"),
					literal("permission"),
					literal("build-blocked")
				]).optional(),
				"timedOut": boolean().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"bundle": string().optional(),
			"version": string().optional(),
			"pendingBuilds": array(string()).optional(),
			"approvedBuilds": array(string()).optional(),
			"registries": array(union([literal(null), string()])).optional(),
			"failedAt": union([literal("registry"), literal("spec-host")]).optional()
		});
		let _deepseek_ai_dsh_plugin_manager_pluginManager_waitForInstall_parameter_0$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_waitForInstall_parameter_0$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_waitForInstall_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_plugin_manager_pluginManager_waitForInstall_result$schema$value;
		const _deepseek_ai_dsh_plugin_manager_pluginManager_waitForInstall_result$schema = () => _deepseek_ai_dsh_plugin_manager_pluginManager_waitForInstall_result$schema$value ??= union([literal(null), object({
			"changed": boolean(),
			"application": union([
				literal("cancelled"),
				literal("failed"),
				literal("applied"),
				literal("restart-required"),
				literal("overridden")
			]),
			"stage": union([
				literal("remove"),
				literal("install"),
				literal("enable")
			]),
			"target": string(),
			"enabled": boolean().optional(),
			"error": object({
				"code": union([
					literal("management-required"),
					literal("unaddressable"),
					literal("unknown-plugin"),
					literal("invalid-spec"),
					literal("ambiguous-install"),
					literal("not-bundle"),
					literal("not-removable"),
					literal("stop-profile"),
					literal("bundle-in-use"),
					literal("stale-approval"),
					literal("incompatible-version"),
					literal("operation-error")
				]),
				"diagnostic": string().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"warnings": array(string()).optional(),
			"packageResult": object({
				"exitCode": number(),
				"output": string(),
				"truncated": boolean(),
				"logPath": string(),
				"kind": union([
					literal("network"),
					literal("unknown"),
					literal("timeout"),
					literal("integrity"),
					literal("pnpm-missing"),
					literal("not-found"),
					literal("no-matching-version"),
					literal("disk-full"),
					literal("permission"),
					literal("build-blocked")
				]).optional(),
				"timedOut": boolean().optional(),
				"incompatible": array(object({
					"name": string(),
					"version": string(),
					"runtimeVersion": string(),
					"peers": record(string(), string())
				})).optional()
			}).optional(),
			"bundle": string().optional(),
			"version": string().optional(),
			"pendingBuilds": array(string()).optional(),
			"approvedBuilds": array(string()).optional(),
			"registries": array(union([literal(null), string()])).optional(),
			"failedAt": union([literal("registry"), literal("spec-host")]).optional()
		})]);
		const TYPERT_REMOTE$13 = {
			package: "@deepseek-ai/dsh-plugin-manager",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/cancelInstall",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "cancelInstall",
					invocation: { kind: "direct" },
					parameters: [{
						name: "requestId",
						wire: "requestId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#PluginInstallRequestId",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_cancelInstall_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#PluginInstallCancellation",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_cancelInstall_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 600,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/inspect",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "inspect",
					invocation: { kind: "direct" },
					parameters: [{
						name: "spec",
						wire: "spec",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/inspect:spec",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_parameter_0$schema
						}
					}, {
						name: "options",
						wire: "options",
						source: "json",
						acceptsUndefined: true,
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#InspectOptions",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_parameter_1$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#PluginSpecInspection",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_inspect_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 350,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/installBundle",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "installBundle",
					invocation: { kind: "direct" },
					parameters: [{
						name: "spec",
						wire: "spec",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/installBundle:spec",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_parameter_0$schema
						}
					}, {
						name: "options",
						wire: "options",
						source: "json",
						acceptsUndefined: true,
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#InstallBundleOptions",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#ChangeResult",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_installBundle_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 473,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/listBundles",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "listBundles",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/listBundles:result",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_listBundles_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 280,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/listPlugins",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "listPlugins",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/listPlugins:result",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_listPlugins_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 256,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/listVersionExemptions",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "listVersionExemptions",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/listVersionExemptions:result",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_listVersionExemptions_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 232,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/registries",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "registries",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#PluginRegistries",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_registries_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 334,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/removeBundle",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "removeBundle",
					invocation: { kind: "direct" },
					parameters: [{
						name: "name",
						wire: "name",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/removeBundle:name",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_removeBundle_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#ChangeResult",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_removeBundle_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 617,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/setBundleEnabled",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "setBundleEnabled",
					invocation: { kind: "direct" },
					parameters: [{
						name: "name",
						wire: "name",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/setBundleEnabled:name",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_parameter_0$schema
						}
					}, {
						name: "enabled",
						wire: "enabled",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/setBundleEnabled:enabled",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#ChangeResult",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_setBundleEnabled_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 452,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/setPluginEnabled",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "setPluginEnabled",
					invocation: { kind: "direct" },
					parameters: [{
						name: "id",
						wire: "id",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-host-plugin-inventory/types#PluginEntryId",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_parameter_0$schema
						}
					}, {
						name: "enabled",
						wire: "enabled",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/setPluginEnabled:enabled",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#ChangeResult",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_setPluginEnabled_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 434,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/setVersionExemption",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "setVersionExemption",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "packageVersion",
							wire: "packageVersion",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/setVersionExemption:packageVersion",
								create: _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_0$schema
							}
						},
						{
							name: "runtimeVersion",
							wire: "runtimeVersion",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/setVersionExemption:runtimeVersion",
								create: _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_1$schema
							}
						},
						{
							name: "enabled",
							wire: "enabled",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/setVersionExemption:enabled",
								create: _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_2$schema
							}
						},
						{
							name: "acceptRisk",
							wire: "acceptRisk",
							source: "json",
							acceptsUndefined: true,
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/setVersionExemption:acceptRisk",
								create: _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_parameter_3$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#ChangeResult",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_setVersionExemption_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 245,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-plugin-manager#pluginManager/waitForInstall",
					service: "pluginManager",
					namespace: "pluginManager",
					method: "waitForInstall",
					invocation: { kind: "direct" },
					parameters: [{
						name: "requestId",
						wire: "requestId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-plugin-manager/types#PluginInstallRequestId",
							create: _deepseek_ai_dsh_plugin_manager_pluginManager_waitForInstall_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-plugin-manager#pluginManager/waitForInstall:result",
						create: _deepseek_ai_dsh_plugin_manager_pluginManager_waitForInstall_result$schema
					},
					sourceLocation: {
						"file": "packages/boot/plugin-manager/src/index.ts",
						"line": 590,
						"column": 9
					}
				}
			]
		};
		//#endregion
		//#region ../../client/ui-plugin-manager/lib/typert.remote-client.js
		let _deepseek_ai_dsh_client_ui_plugin_manager_pluginRegistryProbe_fastest_result$schema$value;
		const _deepseek_ai_dsh_client_ui_plugin_manager_pluginRegistryProbe_fastest_result$schema = () => _deepseek_ai_dsh_client_ui_plugin_manager_pluginRegistryProbe_fastest_result$schema$value ??= union([literal(null), string()]);
		const TYPERT_REMOTE$12 = {
			package: "@deepseek-ai/dsh-client-ui-plugin-manager",
			descriptors: [{
				id: "@deepseek-ai/dsh-client-ui-plugin-manager#pluginRegistryProbe/fastest",
				service: "pluginRegistryProbe",
				namespace: "pluginRegistryProbe",
				method: "fastest",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-client-ui-plugin-manager#pluginRegistryProbe/fastest:result",
					create: _deepseek_ai_dsh_client_ui_plugin_manager_pluginRegistryProbe_fastest_result$schema
				},
				sourceLocation: {
					"file": "packages/client/ui-plugin-manager/src/index.ts",
					"line": 51,
					"column": 9
				}
			}]
		};
		//#endregion
		//#region ../../host/plugin-inventory/lib/typert.remote-client.js
		let _deepseek_ai_dsh_host_plugin_inventory_pluginInventory_list_result$schema$value;
		const _deepseek_ai_dsh_host_plugin_inventory_pluginInventory_list_result$schema = () => _deepseek_ai_dsh_host_plugin_inventory_pluginInventory_list_result$schema$value ??= object({
			"managementAvailable": boolean().readonly().optional(),
			"entries": array(object({
				"entryId": intersection(string(), unknown()).readonly(),
				"moduleName": string().readonly(),
				"meta": object({
					"title": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
					"description": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
					"icon": string().readonly().optional(),
					"error": string().readonly().optional()
				}).readonly().optional(),
				"enabled": boolean().readonly(),
				"fiberPhase": union([
					literal(null),
					literal("failed"),
					literal("pending"),
					literal("active"),
					literal("loading"),
					literal("unloading")
				]).readonly()
			})).readonly(),
			"agentPresets": array(object({
				"id": string().readonly(),
				"name": string().readonly().optional(),
				"isDefault": boolean().readonly(),
				"broken": string().readonly().optional(),
				"rows": array(object({
					"entryId": union([literal(null), string()]).readonly(),
					"moduleName": string().readonly(),
					"meta": object({
						"title": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
						"description": union([string(), intersection(object({ "en": string().readonly() }), record(string(), string()).readonly())]).readonly().optional(),
						"icon": string().readonly().optional(),
						"error": string().readonly().optional()
					}).readonly().optional(),
					"enabled": union([
						literal(false),
						literal(true),
						literal("conditional")
					]).readonly(),
					"condition": string().readonly().optional(),
					"fiberPhase": union([
						literal(null),
						literal("failed"),
						literal("pending"),
						literal("active"),
						literal("loading"),
						literal("unloading")
					]).readonly()
				})).readonly()
			})).readonly().optional()
		});
		const TYPERT_REMOTE$11 = {
			package: "@deepseek-ai/dsh-host-plugin-inventory",
			descriptors: [{
				id: "@deepseek-ai/dsh-host-plugin-inventory#pluginInventory/list",
				service: "pluginInventory",
				namespace: "pluginInventory",
				method: "list",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-host-plugin-inventory/types#PluginInventorySnapshot",
					create: _deepseek_ai_dsh_host_plugin_inventory_pluginInventory_list_result$schema
				},
				sourceLocation: {
					"file": "packages/host/plugin-inventory/src/index.ts",
					"line": 71,
					"column": 9
				}
			}]
		};
		//#endregion
		//#region ../../feedback/message-feedback/lib/typert.remote-client.js
		let _deepseek_ai_dsh_message_feedback_messageFeedback_delete_parameter_0$schema$value;
		const _deepseek_ai_dsh_message_feedback_messageFeedback_delete_parameter_0$schema = () => _deepseek_ai_dsh_message_feedback_messageFeedback_delete_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"messageId": intersection(string(), unknown()).readonly(),
			"ifVersion": intersection(string(), unknown()).readonly()
		});
		let _deepseek_ai_dsh_message_feedback_messageFeedback_delete_result$schema$value;
		const _deepseek_ai_dsh_message_feedback_messageFeedback_delete_result$schema = () => _deepseek_ai_dsh_message_feedback_messageFeedback_delete_result$schema$value ??= union([object({
			"ok": literal(true).readonly(),
			"value": object({ "absent": literal(true).readonly() }).readonly()
		}), object({
			"ok": literal(false).readonly(),
			"error": union([object({
				"code": literal("session-not-found").readonly(),
				"sessionId": intersection(string(), unknown()).readonly()
			}), object({
				"code": literal("version-conflict").readonly(),
				"current": union([literal(null), object({
					"messageId": intersection(string(), unknown()).readonly(),
					"rating": union([literal("positive"), literal("negative")]).readonly(),
					"note": string().readonly().optional(),
					"category": union([
						literal("other"),
						literal("task-result"),
						literal("instruction-following"),
						literal("product-interaction"),
						literal("service-stability"),
						literal("resource-cost"),
						literal("security-privacy-permission")
					]).readonly().optional(),
					"version": intersection(string(), unknown()).readonly(),
					"createdAt": number().readonly(),
					"updatedAt": number().readonly()
				})]).readonly()
			})]).readonly()
		})]);
		let _deepseek_ai_dsh_message_feedback_messageFeedback_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_message_feedback_messageFeedback_list_parameter_0$schema = () => _deepseek_ai_dsh_message_feedback_messageFeedback_list_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_message_feedback_messageFeedback_list_result$schema$value;
		const _deepseek_ai_dsh_message_feedback_messageFeedback_list_result$schema = () => _deepseek_ai_dsh_message_feedback_messageFeedback_list_result$schema$value ??= union([object({
			"ok": literal(true).readonly(),
			"value": object({ "items": array(object({
				"messageId": intersection(string(), unknown()).readonly(),
				"rating": union([literal("positive"), literal("negative")]).readonly(),
				"note": string().readonly().optional(),
				"category": union([
					literal("other"),
					literal("task-result"),
					literal("instruction-following"),
					literal("product-interaction"),
					literal("service-stability"),
					literal("resource-cost"),
					literal("security-privacy-permission")
				]).readonly().optional(),
				"version": intersection(string(), unknown()).readonly(),
				"createdAt": number().readonly(),
				"updatedAt": number().readonly()
			})).readonly() }).readonly()
		}), object({
			"ok": literal(false).readonly(),
			"error": object({
				"code": literal("session-not-found").readonly(),
				"sessionId": intersection(string(), unknown()).readonly()
			}).readonly()
		})]);
		let _deepseek_ai_dsh_message_feedback_messageFeedback_put_parameter_0$schema$value;
		const _deepseek_ai_dsh_message_feedback_messageFeedback_put_parameter_0$schema = () => _deepseek_ai_dsh_message_feedback_messageFeedback_put_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"messageId": intersection(string(), unknown()).readonly(),
			"rating": union([literal("positive"), literal("negative")]).readonly(),
			"note": string().readonly().optional(),
			"category": union([
				literal("other"),
				literal("task-result"),
				literal("instruction-following"),
				literal("product-interaction"),
				literal("service-stability"),
				literal("resource-cost"),
				literal("security-privacy-permission")
			]).readonly().optional(),
			"ifVersion": union([literal(null), intersection(string(), unknown())]).readonly()
		});
		let _deepseek_ai_dsh_message_feedback_messageFeedback_put_result$schema$value;
		const _deepseek_ai_dsh_message_feedback_messageFeedback_put_result$schema = () => _deepseek_ai_dsh_message_feedback_messageFeedback_put_result$schema$value ??= union([object({
			"ok": literal(true).readonly(),
			"value": object({
				"messageId": intersection(string(), unknown()).readonly(),
				"rating": union([literal("positive"), literal("negative")]).readonly(),
				"note": string().readonly().optional(),
				"category": union([
					literal("other"),
					literal("task-result"),
					literal("instruction-following"),
					literal("product-interaction"),
					literal("service-stability"),
					literal("resource-cost"),
					literal("security-privacy-permission")
				]).readonly().optional(),
				"version": intersection(string(), unknown()).readonly(),
				"createdAt": number().readonly(),
				"updatedAt": number().readonly()
			}).readonly()
		}), object({
			"ok": literal(false).readonly(),
			"error": union([
				object({
					"code": literal("session-not-found").readonly(),
					"sessionId": intersection(string(), unknown()).readonly()
				}),
				object({
					"code": literal("target-not-found").readonly(),
					"sessionId": intersection(string(), unknown()).readonly(),
					"messageId": intersection(string(), unknown()).readonly()
				}),
				object({
					"code": literal("version-conflict").readonly(),
					"current": union([literal(null), object({
						"messageId": intersection(string(), unknown()).readonly(),
						"rating": union([literal("positive"), literal("negative")]).readonly(),
						"note": string().readonly().optional(),
						"category": union([
							literal("other"),
							literal("task-result"),
							literal("instruction-following"),
							literal("product-interaction"),
							literal("service-stability"),
							literal("resource-cost"),
							literal("security-privacy-permission")
						]).readonly().optional(),
						"version": intersection(string(), unknown()).readonly(),
						"createdAt": number().readonly(),
						"updatedAt": number().readonly()
					})]).readonly()
				}),
				object({ "code": literal("note-blank").readonly() }),
				object({
					"code": literal("note-too-large").readonly(),
					"maxBytes": number().readonly(),
					"actualBytes": number().readonly()
				})
			]).readonly()
		})]);
		const TYPERT_REMOTE$10 = {
			package: "@deepseek-ai/dsh-message-feedback",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-message-feedback#messageFeedback/delete",
					service: "messageFeedback",
					namespace: "messageFeedback",
					method: "delete",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-message-feedback/types#MessageFeedbackDeleteRequest",
							create: _deepseek_ai_dsh_message_feedback_messageFeedback_delete_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-message-feedback/types#MessageFeedbackDeleteResult",
						create: _deepseek_ai_dsh_message_feedback_messageFeedback_delete_result$schema
					},
					sourceLocation: {
						"file": "packages/feedback/message-feedback/src/index.ts",
						"line": 207,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-message-feedback#messageFeedback/list",
					service: "messageFeedback",
					namespace: "messageFeedback",
					method: "list",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-message-feedback/types#MessageFeedbackListRequest",
							create: _deepseek_ai_dsh_message_feedback_messageFeedback_list_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-message-feedback/types#MessageFeedbackListResult",
						create: _deepseek_ai_dsh_message_feedback_messageFeedback_list_result$schema
					},
					sourceLocation: {
						"file": "packages/feedback/message-feedback/src/index.ts",
						"line": 155,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-message-feedback#messageFeedback/put",
					service: "messageFeedback",
					namespace: "messageFeedback",
					method: "put",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-message-feedback/types#MessageFeedbackPutRequest",
							create: _deepseek_ai_dsh_message_feedback_messageFeedback_put_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-message-feedback/types#MessageFeedbackPutResult",
						create: _deepseek_ai_dsh_message_feedback_messageFeedback_put_result$schema
					},
					sourceLocation: {
						"file": "packages/feedback/message-feedback/src/index.ts",
						"line": 167,
						"column": 3
					}
				}
			]
		};
		//#endregion
		//#region ../../interaction/permission-presets/lib/typert.remote-client.js
		let _deepseek_ai_dsh_permission_presets_permissionPresets_catalog_result$schema$value;
		const _deepseek_ai_dsh_permission_presets_permissionPresets_catalog_result$schema = () => _deepseek_ai_dsh_permission_presets_permissionPresets_catalog_result$schema$value ??= object({
			"options": array(object({
				"value": string(),
				"name": string(),
				"description": string().optional()
			})),
			"defaultOptions": array(object({
				"value": string(),
				"name": string(),
				"description": string().optional()
			})),
			"defaultPreset": string()
		});
		const TYPERT_REMOTE$9 = {
			package: "@deepseek-ai/dsh-permission-presets",
			descriptors: [{
				id: "@deepseek-ai/dsh-permission-presets#permissionPresets/catalog",
				service: "permissionPresets",
				namespace: "permissionPresets",
				method: "catalog",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-permission-presets/client#PermissionCatalog",
					create: _deepseek_ai_dsh_permission_presets_permissionPresets_catalog_result$schema
				},
				sourceLocation: {
					"file": "packages/interaction/permission-presets/src/index.ts",
					"line": 293,
					"column": 3
				}
			}]
		};
		//#endregion
		//#region ../../feedback/command-feedback/lib/typert.remote-client.js
		let _deepseek_ai_dsh_command_feedback_sessionFeedback_record_parameter_0$schema$value;
		const _deepseek_ai_dsh_command_feedback_sessionFeedback_record_parameter_0$schema = () => _deepseek_ai_dsh_command_feedback_sessionFeedback_record_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"text": string().readonly().optional(),
			"category": union([
				literal("other"),
				literal("task-result"),
				literal("instruction-following"),
				literal("product-interaction"),
				literal("service-stability"),
				literal("resource-cost"),
				literal("security-privacy-permission")
			]).readonly().optional()
		});
		let _deepseek_ai_dsh_command_feedback_sessionFeedback_record_result$schema$value;
		const _deepseek_ai_dsh_command_feedback_sessionFeedback_record_result$schema = () => _deepseek_ai_dsh_command_feedback_sessionFeedback_record_result$schema$value ??= union([object({
			"ok": literal(true).readonly(),
			"value": object({ "recorded": literal(true).readonly() }).readonly()
		}), object({
			"ok": literal(false).readonly(),
			"error": object({
				"code": literal("session-not-found").readonly(),
				"sessionId": intersection(string(), unknown()).readonly()
			}).readonly()
		})]);
		const TYPERT_REMOTE$8 = {
			package: "@deepseek-ai/dsh-command-feedback",
			descriptors: [{
				id: "@deepseek-ai/dsh-command-feedback#sessionFeedback/record",
				service: "sessionFeedback",
				namespace: "sessionFeedback",
				method: "record",
				invocation: { kind: "direct" },
				parameters: [{
					name: "request",
					wire: "request",
					source: "json",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-command-feedback/types#SessionFeedbackRecordRequest",
						create: _deepseek_ai_dsh_command_feedback_sessionFeedback_record_parameter_0$schema
					}
				}],
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-command-feedback/types#SessionFeedbackRecordResult",
					create: _deepseek_ai_dsh_command_feedback_sessionFeedback_record_result$schema
				},
				sourceLocation: {
					"file": "packages/feedback/command-feedback/src/index.ts",
					"line": 102,
					"column": 3
				}
			}]
		};
		//#endregion
		//#region ../../client/file-upload/lib/typert.remote-client.js
		let _deepseek_ai_dsh_client_file_upload_fileUploads_upload_parameter_0$schema$value;
		const _deepseek_ai_dsh_client_file_upload_fileUploads_upload_parameter_0$schema = () => _deepseek_ai_dsh_client_file_upload_fileUploads_upload_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_client_file_upload_fileUploads_upload_parameter_1$schema$value;
		const _deepseek_ai_dsh_client_file_upload_fileUploads_upload_parameter_1$schema = () => _deepseek_ai_dsh_client_file_upload_fileUploads_upload_parameter_1$schema$value ??= object({
			"data": string().readonly(),
			"name": string().readonly().optional()
		});
		let _deepseek_ai_dsh_client_file_upload_fileUploads_upload_result$schema$value;
		const _deepseek_ai_dsh_client_file_upload_fileUploads_upload_result$schema = () => _deepseek_ai_dsh_client_file_upload_fileUploads_upload_result$schema$value ??= object({
			"receiptId": intersection(string(), unknown()).readonly(),
			"file": object({
				"attachmentId": intersection(string(), unknown()),
				"name": string(),
				"bytes": number()
			}).readonly()
		});
		const TYPERT_REMOTE$7 = {
			package: "@deepseek-ai/dsh-client-file-upload",
			descriptors: [{
				id: "@deepseek-ai/dsh-client-file-upload#fileUploads/upload",
				service: "fileUploads",
				namespace: "fileUploads",
				method: "upload",
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [{
					name: "agent",
					wire: "agentId",
					source: "lookup",
					lookup: "agent",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
						create: _deepseek_ai_dsh_client_file_upload_fileUploads_upload_parameter_0$schema
					}
				}, {
					name: "request",
					wire: "request",
					source: "json",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-client-file-upload/types#EncodedFileUploadRequest",
						create: _deepseek_ai_dsh_client_file_upload_fileUploads_upload_parameter_1$schema
					}
				}],
				cancellation: { parameter: "signal" },
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-client-file-upload/types#FileUploadValue",
					create: _deepseek_ai_dsh_client_file_upload_fileUploads_upload_result$schema
				},
				sourceLocation: {
					"file": "packages/client/file-upload/src/index.ts",
					"line": 105,
					"column": 3
				}
			}]
		};
		//#endregion
		//#region ../../context/session-reference/lib/typert.remote-client.js
		let _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_parameter_0$schema$value;
		const _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_parameter_0$schema = () => _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_parameter_1$schema$value;
		const _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_parameter_1$schema = () => _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_result$schema$value;
		const _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_result$schema = () => _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_result$schema$value ??= array(object({
			"mention": string(),
			"sessionId": intersection(string(), unknown()),
			"label": string(),
			"displayTitle": string().optional(),
			"cwd": string().optional(),
			"sameWorkspace": boolean(),
			"createdAt": number()
		}));
		const TYPERT_REMOTE$6 = {
			package: "@deepseek-ai/dsh-session-reference",
			descriptors: [{
				id: "@deepseek-ai/dsh-session-reference#sessionReferenceResolver/candidates",
				service: "sessionReferenceResolver",
				namespace: "sessionReferenceResolver",
				method: "candidates",
				implementation: "remoteExportCandidates",
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [{
					name: "agent",
					wire: "agentId",
					source: "lookup",
					lookup: "agent",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
						create: _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_parameter_0$schema
					}
				}, {
					name: "query",
					wire: "query",
					source: "json",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-session-reference#sessionReferenceResolver/candidates:query",
						create: _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_parameter_1$schema
					}
				}],
				cancellation: { parameter: "signal" },
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-session-reference#sessionReferenceResolver/candidates:result",
					create: _deepseek_ai_dsh_session_reference_sessionReferenceResolver_candidates_result$schema
				},
				sourceLocation: {
					"file": "packages/context/session-reference/src/index.ts",
					"line": 272,
					"column": 9
				}
			}]
		};
		//#endregion
		//#region ../../subagent/subagent/lib/typert.remote-client.js
		let _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_0$schema$value;
		const _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_0$schema = () => _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_1$schema$value;
		const _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_1$schema = () => _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_2$schema$value;
		const _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_2$schema = () => _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_2$schema$value ??= literal("continuable");
		let _deepseek_ai_dsh_subagent_subagents_interruptByParent_result$schema$value;
		const _deepseek_ai_dsh_subagent_subagents_interruptByParent_result$schema = () => _deepseek_ai_dsh_subagent_subagents_interruptByParent_result$schema$value ??= object({ "accepted": literal(true).readonly() });
		let _deepseek_ai_dsh_subagent_subagents_prompt_parameter_0$schema$value;
		const _deepseek_ai_dsh_subagent_subagents_prompt_parameter_0$schema = () => _deepseek_ai_dsh_subagent_subagents_prompt_parameter_0$schema$value ??= object({
			"requestId": intersection(string(), unknown()).readonly(),
			"parentSessionId": intersection(string(), unknown()).readonly(),
			"childSessionId": intersection(string(), unknown()).readonly(),
			"mode": literal("continuable").readonly(),
			"delivery": union([literal("queue"), literal("steer")]).readonly(),
			"content": array(union([object({
				"type": literal("text").readonly(),
				"text": string().readonly()
			}), object({
				"type": literal("image").readonly(),
				"mediaType": union([
					literal("image/png"),
					literal("image/jpeg"),
					literal("image/webp"),
					literal("image/gif")
				]).readonly(),
				"data": string().readonly(),
				"name": string().readonly().optional()
			})])).readonly(),
			"clientTimeZone": string().readonly().optional()
		});
		let _deepseek_ai_dsh_subagent_subagents_prompt_result$schema$value;
		const _deepseek_ai_dsh_subagent_subagents_prompt_result$schema = () => _deepseek_ai_dsh_subagent_subagents_prompt_result$schema$value ??= object({ "messageId": intersection(string(), unknown()).readonly() });
		const TYPERT_REMOTE$5 = {
			package: "@deepseek-ai/dsh-subagent",
			descriptors: [{
				id: "@deepseek-ai/dsh-subagent#subagents/interruptByParent",
				service: "subagents",
				namespace: "subagents",
				method: "interruptByParent",
				invocation: { kind: "direct" },
				parameters: [
					{
						name: "childSessionId",
						wire: "childSessionId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_0$schema
						}
					},
					{
						name: "parentSessionId",
						wire: "parentSessionId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_1$schema
						}
					},
					{
						name: "mode",
						wire: "mode",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-subagent#subagents/interruptByParent:mode",
							create: _deepseek_ai_dsh_subagent_subagents_interruptByParent_parameter_2$schema
						}
					}
				],
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-subagent/client#SubagentInterruptReceipt",
					create: _deepseek_ai_dsh_subagent_subagents_interruptByParent_result$schema
				},
				sourceLocation: {
					"file": "packages/subagent/subagent/src/index.ts",
					"line": 481,
					"column": 3
				}
			}, {
				id: "@deepseek-ai/dsh-subagent#subagents/prompt",
				service: "subagents",
				namespace: "subagents",
				method: "prompt",
				invocation: { kind: "direct" },
				parameters: [{
					name: "request",
					wire: "request",
					source: "json",
					codec: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-subagent/client#SubagentPromptRequest",
						create: _deepseek_ai_dsh_subagent_subagents_prompt_parameter_0$schema
					}
				}],
				cancellation: { parameter: "signal" },
				result: {
					mode: "strict",
					typeSymbol: "@deepseek-ai/dsh-subagent/client#SubagentPromptReceipt",
					create: _deepseek_ai_dsh_subagent_subagents_prompt_result$schema
				},
				sourceLocation: {
					"file": "packages/subagent/subagent/src/index.ts",
					"line": 414,
					"column": 9
				}
			}]
		};
		//#endregion
		//#region ../session-controller/lib/typert.remote-client.js
		let JsonValueRemoteCodec$schema$value;
		const JsonValueRemoteCodec$schema = () => JsonValueRemoteCodec$schema$value ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema()))
		]);
		let JsonValueRemoteCodec$schema2$value;
		const JsonValueRemoteCodec$schema2 = () => JsonValueRemoteCodec$schema2$value ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema2())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema2()))
		]);
		let JsonValueRemoteCodec$schema3$value;
		const JsonValueRemoteCodec$schema3 = () => JsonValueRemoteCodec$schema3$value ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema3())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
		]);
		let JsonValueRemoteCodec$schema4$value;
		const JsonValueRemoteCodec$schema4 = () => JsonValueRemoteCodec$schema4$value ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema4())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema4()))
		]);
		let JsonValueRemoteCodec$schema5$value;
		const JsonValueRemoteCodec$schema5 = () => JsonValueRemoteCodec$schema5$value ??= union([
			literal(null),
			string(),
			number(),
			literal(false),
			literal(true),
			array(lazy(() => JsonValueRemoteCodec$schema5())),
			record(string(), lazy(() => JsonValueRemoteCodec$schema5()))
		]);
		let _deepseek_ai_dsh_api_session_controller_fileReferences_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_fileReferences_list_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_fileReferences_list_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_session_controller_fileReferences_list_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_session_controller_fileReferences_list_parameter_1$schema = () => _deepseek_ai_dsh_api_session_controller_fileReferences_list_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_session_controller_fileReferences_list_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_fileReferences_list_result$schema = () => _deepseek_ai_dsh_api_session_controller_fileReferences_list_result$schema$value ??= array(object({
			"path": string(),
			"kind": union([literal("file"), literal("directory")])
		}));
		let _deepseek_ai_dsh_api_session_controller_session_attachment_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_attachment_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_attachment_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"attachmentId": intersection(string(), unknown()).readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_attachment_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_attachment_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_attachment_result$schema$value ??= object({
			"attachment": object({
				"attachmentId": intersection(string(), unknown()),
				"mediaType": union([
					literal("image/png"),
					literal("image/jpeg"),
					literal("image/webp"),
					literal("image/gif")
				]),
				"bytes": number(),
				"width": number(),
				"height": number(),
				"name": string().optional(),
				"originalDimensions": object({
					"width": number(),
					"height": number()
				}).optional()
			}).readonly(),
			"data": string().readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_cancel_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_cancel_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_cancel_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_cancel_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_cancel_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_cancel_result$schema$value ??= object({ "accepted": literal(true).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_canOpenWorkspacePath_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_canOpenWorkspacePath_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_canOpenWorkspacePath_result$schema$value ??= boolean();
		let _deepseek_ai_dsh_api_session_controller_session_control_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_control_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_control_result$schema$value ??= union([object({
			"type": literal("baseline").readonly(),
			"value": object({ "projections": record(intersection(string(), unknown()), object({
				"asOfSeq": number().readonly(),
				"values": intersection(object({
					"inbox": object({
						"next-turn": array(union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema5())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema5()))
						])).readonly(),
						"next-step": array(union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema5())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema5()))
						])).readonly()
					}).optional(),
					"agentPreset": union([literal(null), string()]).optional(),
					"title": union([literal(null), string()]).optional(),
					"todos": union([literal(null), array(object({
						"content": string(),
						"status": union([
							literal("completed"),
							literal("pending"),
							literal("in_progress")
						])
					}))]).optional(),
					"sessionListMetadata": object({
						"blank": boolean().readonly(),
						"lastPromptAt": union([literal(null), number()]).readonly()
					}).optional(),
					"imageLimits": object({
						"maxImageBytes": number(),
						"maxImagesPerMessage": number(),
						"maxMessageImageBytes": number(),
						"maxImagePixels": number(),
						"maxImageDimension": number(),
						"mediaTypes": array(union([
							literal("image/png"),
							literal("image/jpeg"),
							literal("image/webp"),
							literal("image/gif")
						]))
					}).optional(),
					"modelSelection": object({
						"lastUsed": union([literal(null), object({
							"provider": string().readonly(),
							"model": string().readonly(),
							"reasoningEffort": string().readonly().optional()
						})]).readonly(),
						"next": union([literal(null), object({
							"provider": string().readonly(),
							"model": string().readonly(),
							"reasoningEffort": string().readonly().optional()
						})]).readonly()
					}).optional(),
					"permissions": object({ "currentValue": string() }).optional(),
					"subagentCatalog": array(union([
						intersection(object({
							"id": intersection(string(), unknown()).readonly(),
							"createdAt": number().readonly()
						}), object({
							"mode": literal("one-shot").readonly(),
							"label": string().readonly().optional()
						})),
						intersection(object({
							"id": intersection(string(), unknown()).readonly(),
							"createdAt": number().readonly()
						}), object({
							"mode": literal("continuable").readonly(),
							"label": string().readonly()
						})),
						intersection(object({
							"id": intersection(string(), unknown()).readonly(),
							"createdAt": number().readonly()
						}), object({
							"mode": literal("unknown").readonly(),
							"label": string().readonly().optional()
						}))
					])).optional(),
					"subagentTiming": object({
						"settledMs": number(),
						"active": object({
							"since": number(),
							"through": number()
						}).optional(),
						"lastTurnCompleted": boolean().optional()
					}).optional(),
					"subagent": union([
						literal(null),
						object({
							"mode": literal("one-shot"),
							"label": string().optional(),
							"seq": intersection(number(), unknown())
						}),
						object({
							"mode": literal("continuable"),
							"label": string(),
							"seq": intersection(number(), unknown())
						})
					]).optional(),
					"tokenUsage": object({
						"uncachedInputTokens": number(),
						"outputTokens": number(),
						"cacheReadTokens": number(),
						"cacheWriteTokens": number()
					}).optional(),
					"contextPressure": object({
						"pressureTokens": number().optional(),
						"projectedTokens": number().optional(),
						"contextWindow": number().optional()
					}).optional(),
					"contextBreakdown": object({
						"systemTokens": number(),
						"toolsTokens": number(),
						"messageTokens": number()
					}).optional(),
					"userQuestions": object({
						"active": array(object({
							"callId": intersection(string(), unknown()).readonly(),
							"questions": array(object({
								"id": string(),
								"question": string(),
								"detail": string().optional(),
								"header": string().optional(),
								"options": array(object({
									"label": string(),
									"description": string().optional()
								})).optional(),
								"multiSelect": boolean().optional(),
								"intent": object({
									"kind": literal("plan-review"),
									"approve": string(),
									"callId": intersection(string(), unknown()).optional()
								}).optional()
							})).readonly(),
							"state": union([literal("open"), literal("continued")]).readonly()
						})).readonly(),
						"settled": array(object({
							"callId": intersection(string(), unknown()).readonly(),
							"answers": array(object({
								"id": string(),
								"selected": array(string()),
								"custom": string().optional()
							})).readonly()
						})).readonly()
					}).optional(),
					"goal": union([literal(null), object({
						"goal": object({
							"objective": string().readonly(),
							"phase": union([
								literal("active"),
								literal("paused"),
								literal("blocked"),
								literal("complete")
							]).readonly(),
							"blockedReason": object({
								"code": string().readonly(),
								"message": string().readonly()
							}).readonly().optional(),
							"maxGoalRounds": number().readonly(),
							"id": intersection(string(), unknown()).readonly(),
							"revision": number().readonly()
						}).readonly(),
						"roundsStarted": number().readonly(),
						"createdAt": number().readonly(),
						"updatedAt": number().readonly()
					})]).optional()
				}), record(string(), union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema5())),
					record(string(), lazy(() => JsonValueRemoteCodec$schema5()))
				])).readonly()).readonly()
			})).readonly().readonly() }).readonly()
		}), intersection(object({ "type": literal("projection").readonly() }), object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"key": string().readonly(),
			"value": union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema5())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema5()))
			]).readonly(),
			"seq": number().readonly()
		}))]);
		let _deepseek_ai_dsh_api_session_controller_session_create_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_create_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_create_parameter_0$schema$value ??= object({
			"workspaceId": intersection(string(), unknown()).readonly().optional(),
			"cwd": string().readonly().optional(),
			"sessionId": intersection(string(), unknown()).readonly().optional(),
			"agentPreset": string().readonly().optional()
		});
		let _deepseek_ai_dsh_api_session_controller_session_create_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_create_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_create_result$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"agentPreset": string().readonly().optional()
		});
		let _deepseek_ai_dsh_api_session_controller_session_follow_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_follow_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_follow_parameter_0$schema$value ??= object({
			"address": union([object({
				"kind": literal("session").readonly(),
				"sessionId": intersection(string(), unknown()).readonly()
			}), object({
				"kind": literal("subagent").readonly(),
				"parentSessionId": intersection(string(), unknown()).readonly(),
				"childSessionId": intersection(string(), unknown()).readonly(),
				"mode": union([
					literal("one-shot"),
					literal("continuable"),
					literal("unknown")
				]).readonly()
			})]).readonly(),
			"assistantStream": literal(true).readonly().optional(),
			"maxMessages": number().readonly().optional(),
			"turnWindow": object({
				"minMessages": number().readonly(),
				"minTurns": number().readonly()
			}).readonly().optional()
		});
		let _deepseek_ai_dsh_api_session_controller_session_follow_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_follow_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_follow_result$schema$value ??= union([
			object({
				"type": literal("event").readonly(),
				"event": object({
					"type": string().readonly(),
					"seq": number().readonly(),
					"time": number().readonly(),
					"data": union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema3())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
					]).readonly(),
					"ignorable": literal(true).readonly().optional(),
					"sourceEventSeqs": union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema3())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
					]).readonly().optional(),
					"surfaceOp": union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema3())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
					]).readonly().optional()
				}).readonly()
			}),
			object({
				"type": literal("snapshot").readonly(),
				"header": object({
					"version": number().readonly(),
					"id": intersection(string(), unknown()).readonly(),
					"createdAt": number().readonly(),
					"cwd": string().readonly().optional(),
					"parentSession": intersection(string(), unknown()).readonly().optional(),
					"isSeeded": boolean().readonly(),
					"origin": literal("subagent").readonly().optional(),
					"delegationDepth": number().readonly().optional(),
					"agentPreset": string().readonly().optional()
				}).readonly(),
				"cursor": number().readonly(),
				"records": array(object({
					"type": literal("event").readonly(),
					"event": object({
						"type": string().readonly(),
						"seq": number().readonly(),
						"time": number().readonly(),
						"data": union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema3())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
						]).readonly(),
						"ignorable": literal(true).readonly().optional(),
						"sourceEventSeqs": union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema3())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
						]).readonly().optional(),
						"surfaceOp": union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema3())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
						]).readonly().optional()
					}).readonly()
				})).readonly(),
				"hasMore": boolean().readonly(),
				"projections": object({
					"asOfSeq": number().readonly(),
					"values": intersection(object({
						"inbox": object({
							"next-turn": array(union([
								literal(null),
								string(),
								number(),
								literal(false),
								literal(true),
								array(lazy(() => JsonValueRemoteCodec$schema3())),
								record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
							])).readonly(),
							"next-step": array(union([
								literal(null),
								string(),
								number(),
								literal(false),
								literal(true),
								array(lazy(() => JsonValueRemoteCodec$schema3())),
								record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
							])).readonly()
						}).optional(),
						"agentPreset": union([literal(null), string()]).optional(),
						"title": union([literal(null), string()]).optional(),
						"todos": union([literal(null), array(object({
							"content": string(),
							"status": union([
								literal("completed"),
								literal("pending"),
								literal("in_progress")
							])
						}))]).optional(),
						"sessionListMetadata": object({
							"blank": boolean().readonly(),
							"lastPromptAt": union([literal(null), number()]).readonly()
						}).optional(),
						"imageLimits": object({
							"maxImageBytes": number(),
							"maxImagesPerMessage": number(),
							"maxMessageImageBytes": number(),
							"maxImagePixels": number(),
							"maxImageDimension": number(),
							"mediaTypes": array(union([
								literal("image/png"),
								literal("image/jpeg"),
								literal("image/webp"),
								literal("image/gif")
							]))
						}).optional(),
						"modelSelection": object({
							"lastUsed": union([literal(null), object({
								"provider": string().readonly(),
								"model": string().readonly(),
								"reasoningEffort": string().readonly().optional()
							})]).readonly(),
							"next": union([literal(null), object({
								"provider": string().readonly(),
								"model": string().readonly(),
								"reasoningEffort": string().readonly().optional()
							})]).readonly()
						}).optional(),
						"permissions": object({ "currentValue": string() }).optional(),
						"subagentCatalog": array(union([
							intersection(object({
								"id": intersection(string(), unknown()).readonly(),
								"createdAt": number().readonly()
							}), object({
								"mode": literal("one-shot").readonly(),
								"label": string().readonly().optional()
							})),
							intersection(object({
								"id": intersection(string(), unknown()).readonly(),
								"createdAt": number().readonly()
							}), object({
								"mode": literal("continuable").readonly(),
								"label": string().readonly()
							})),
							intersection(object({
								"id": intersection(string(), unknown()).readonly(),
								"createdAt": number().readonly()
							}), object({
								"mode": literal("unknown").readonly(),
								"label": string().readonly().optional()
							}))
						])).optional(),
						"subagentTiming": object({
							"settledMs": number(),
							"active": object({
								"since": number(),
								"through": number()
							}).optional(),
							"lastTurnCompleted": boolean().optional()
						}).optional(),
						"subagent": union([
							literal(null),
							object({
								"mode": literal("one-shot"),
								"label": string().optional(),
								"seq": intersection(number(), unknown())
							}),
							object({
								"mode": literal("continuable"),
								"label": string(),
								"seq": intersection(number(), unknown())
							})
						]).optional(),
						"tokenUsage": object({
							"uncachedInputTokens": number(),
							"outputTokens": number(),
							"cacheReadTokens": number(),
							"cacheWriteTokens": number()
						}).optional(),
						"contextPressure": object({
							"pressureTokens": number().optional(),
							"projectedTokens": number().optional(),
							"contextWindow": number().optional()
						}).optional(),
						"contextBreakdown": object({
							"systemTokens": number(),
							"toolsTokens": number(),
							"messageTokens": number()
						}).optional(),
						"userQuestions": object({
							"active": array(object({
								"callId": intersection(string(), unknown()).readonly(),
								"questions": array(object({
									"id": string(),
									"question": string(),
									"detail": string().optional(),
									"header": string().optional(),
									"options": array(object({
										"label": string(),
										"description": string().optional()
									})).optional(),
									"multiSelect": boolean().optional(),
									"intent": object({
										"kind": literal("plan-review"),
										"approve": string(),
										"callId": intersection(string(), unknown()).optional()
									}).optional()
								})).readonly(),
								"state": union([literal("open"), literal("continued")]).readonly()
							})).readonly(),
							"settled": array(object({
								"callId": intersection(string(), unknown()).readonly(),
								"answers": array(object({
									"id": string(),
									"selected": array(string()),
									"custom": string().optional()
								})).readonly()
							})).readonly()
						}).optional(),
						"goal": union([literal(null), object({
							"goal": object({
								"objective": string().readonly(),
								"phase": union([
									literal("active"),
									literal("paused"),
									literal("blocked"),
									literal("complete")
								]).readonly(),
								"blockedReason": object({
									"code": string().readonly(),
									"message": string().readonly()
								}).readonly().optional(),
								"maxGoalRounds": number().readonly(),
								"id": intersection(string(), unknown()).readonly(),
								"revision": number().readonly()
							}).readonly(),
							"roundsStarted": number().readonly(),
							"createdAt": number().readonly(),
							"updatedAt": number().readonly()
						})]).optional()
					}), record(string(), union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema3())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
					])).readonly()).readonly()
				}).readonly(),
				"assistantStream": object({
					"revision": number().readonly(),
					"activeAttempt": object({
						"attemptId": intersection(string(), unknown()).readonly(),
						"startedAfterSeq": union([intersection(number(), unknown()), literal(-1)]).readonly(),
						"turn": number().readonly(),
						"step": number().readonly(),
						"nextIndex": number().readonly(),
						"stream": array(union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema3())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
						])).readonly()
					}).readonly().optional()
				}).readonly().optional()
			}),
			object({
				"type": literal("assistant-stream").readonly(),
				"frame": union([
					object({
						"type": literal("start").readonly(),
						"attemptId": intersection(string(), unknown()).readonly(),
						"revision": number().readonly(),
						"startedAfterSeq": union([intersection(number(), unknown()), literal(-1)]).readonly(),
						"turn": number().readonly(),
						"step": number().readonly()
					}),
					object({
						"type": literal("chunk").readonly(),
						"attemptId": intersection(string(), unknown()).readonly(),
						"revision": number().readonly(),
						"index": number().readonly(),
						"time": number().readonly(),
						"chunk": union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema3())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema3()))
						]).readonly()
					}),
					object({
						"type": literal("end").readonly(),
						"attemptId": intersection(string(), unknown()).readonly(),
						"revision": number().readonly(),
						"index": number().readonly(),
						"outcome": union([object({
							"kind": literal("committed").readonly(),
							"eventType": union([literal("assistant/message"), literal("assistant/attempt")]).readonly(),
							"seq": number().readonly()
						}), object({ "kind": literal("abandoned").readonly() })]).readonly()
					})
				]).readonly()
			})
		]);
		let _deepseek_ai_dsh_api_session_controller_session_fork_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_fork_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_fork_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"atSeq": number().readonly().optional()
		});
		let _deepseek_ai_dsh_api_session_controller_session_fork_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_fork_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_fork_result$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_initializeDefaultModel_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_initializeDefaultModel_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_initializeDefaultModel_result$schema$value ??= _void();
		let _deepseek_ai_dsh_api_session_controller_session_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_list_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_list_parameter_0$schema$value ??= object({ "cursor": string().readonly().optional() });
		let _deepseek_ai_dsh_api_session_controller_session_list_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_list_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_list_result$schema$value ??= object({ "items": array(object({
			"agentAvailable": boolean().readonly(),
			"sessionId": intersection(string(), unknown()).readonly(),
			"updatedAt": number().readonly(),
			"running": boolean().readonly(),
			"blank": boolean().readonly(),
			"parentSessionId": intersection(string(), unknown()).readonly().optional(),
			"origin": literal("subagent").readonly().optional(),
			"cwd": string().readonly().optional(),
			"projections": object({
				"kind": union([literal("cached"), literal("sequenced")]).readonly(),
				"asOfSeq": number().readonly(),
				"values": intersection(object({
					"inbox": object({
						"next-turn": array(union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema()))
						])).readonly(),
						"next-step": array(union([
							literal(null),
							string(),
							number(),
							literal(false),
							literal(true),
							array(lazy(() => JsonValueRemoteCodec$schema())),
							record(string(), lazy(() => JsonValueRemoteCodec$schema()))
						])).readonly()
					}).optional(),
					"agentPreset": union([literal(null), string()]).optional(),
					"title": union([literal(null), string()]).optional(),
					"todos": union([literal(null), array(object({
						"content": string(),
						"status": union([
							literal("completed"),
							literal("pending"),
							literal("in_progress")
						])
					}))]).optional(),
					"sessionListMetadata": object({
						"blank": boolean().readonly(),
						"lastPromptAt": union([literal(null), number()]).readonly()
					}).optional(),
					"imageLimits": object({
						"maxImageBytes": number(),
						"maxImagesPerMessage": number(),
						"maxMessageImageBytes": number(),
						"maxImagePixels": number(),
						"maxImageDimension": number(),
						"mediaTypes": array(union([
							literal("image/png"),
							literal("image/jpeg"),
							literal("image/webp"),
							literal("image/gif")
						]))
					}).optional(),
					"modelSelection": object({
						"lastUsed": union([literal(null), object({
							"provider": string().readonly(),
							"model": string().readonly(),
							"reasoningEffort": string().readonly().optional()
						})]).readonly(),
						"next": union([literal(null), object({
							"provider": string().readonly(),
							"model": string().readonly(),
							"reasoningEffort": string().readonly().optional()
						})]).readonly()
					}).optional(),
					"permissions": object({ "currentValue": string() }).optional(),
					"subagentCatalog": array(union([
						intersection(object({
							"id": intersection(string(), unknown()).readonly(),
							"createdAt": number().readonly()
						}), object({
							"mode": literal("one-shot").readonly(),
							"label": string().readonly().optional()
						})),
						intersection(object({
							"id": intersection(string(), unknown()).readonly(),
							"createdAt": number().readonly()
						}), object({
							"mode": literal("continuable").readonly(),
							"label": string().readonly()
						})),
						intersection(object({
							"id": intersection(string(), unknown()).readonly(),
							"createdAt": number().readonly()
						}), object({
							"mode": literal("unknown").readonly(),
							"label": string().readonly().optional()
						}))
					])).optional(),
					"subagentTiming": object({
						"settledMs": number(),
						"active": object({
							"since": number(),
							"through": number()
						}).optional(),
						"lastTurnCompleted": boolean().optional()
					}).optional(),
					"subagent": union([
						literal(null),
						object({
							"mode": literal("one-shot"),
							"label": string().optional(),
							"seq": intersection(number(), unknown())
						}),
						object({
							"mode": literal("continuable"),
							"label": string(),
							"seq": intersection(number(), unknown())
						})
					]).optional(),
					"tokenUsage": object({
						"uncachedInputTokens": number(),
						"outputTokens": number(),
						"cacheReadTokens": number(),
						"cacheWriteTokens": number()
					}).optional(),
					"contextPressure": object({
						"pressureTokens": number().optional(),
						"projectedTokens": number().optional(),
						"contextWindow": number().optional()
					}).optional(),
					"contextBreakdown": object({
						"systemTokens": number(),
						"toolsTokens": number(),
						"messageTokens": number()
					}).optional(),
					"userQuestions": object({
						"active": array(object({
							"callId": intersection(string(), unknown()).readonly(),
							"questions": array(object({
								"id": string(),
								"question": string(),
								"detail": string().optional(),
								"header": string().optional(),
								"options": array(object({
									"label": string(),
									"description": string().optional()
								})).optional(),
								"multiSelect": boolean().optional(),
								"intent": object({
									"kind": literal("plan-review"),
									"approve": string(),
									"callId": intersection(string(), unknown()).optional()
								}).optional()
							})).readonly(),
							"state": union([literal("open"), literal("continued")]).readonly()
						})).readonly(),
						"settled": array(object({
							"callId": intersection(string(), unknown()).readonly(),
							"answers": array(object({
								"id": string(),
								"selected": array(string()),
								"custom": string().optional()
							})).readonly()
						})).readonly()
					}).optional(),
					"goal": union([literal(null), object({
						"goal": object({
							"objective": string().readonly(),
							"phase": union([
								literal("active"),
								literal("paused"),
								literal("blocked"),
								literal("complete")
							]).readonly(),
							"blockedReason": object({
								"code": string().readonly(),
								"message": string().readonly()
							}).readonly().optional(),
							"maxGoalRounds": number().readonly(),
							"id": intersection(string(), unknown()).readonly(),
							"revision": number().readonly()
						}).readonly(),
						"roundsStarted": number().readonly(),
						"createdAt": number().readonly(),
						"updatedAt": number().readonly()
					})]).optional()
				}), record(string(), union([
					literal(null),
					string(),
					number(),
					literal(false),
					literal(true),
					array(lazy(() => JsonValueRemoteCodec$schema())),
					record(string(), lazy(() => JsonValueRemoteCodec$schema()))
				])).readonly()).readonly()
			}).readonly().optional()
		})).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_modelCatalog_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_modelCatalog_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_modelCatalog_result$schema$value ??= object({
			"default": object({
				"provider": string().readonly(),
				"model": string().readonly(),
				"reasoningEffort": string().readonly().optional()
			}).readonly(),
			"routableProviders": array(string()).readonly(),
			"groups": array(object({
				"id": string().readonly(),
				"name": string().readonly(),
				"models": array(object({
					"id": string().readonly(),
					"name": string().readonly(),
					"description": string().readonly().optional(),
					"reasoning": object({
						"efforts": array(object({
							"id": string().readonly(),
							"name": string().readonly(),
							"description": string().readonly().optional()
						})).readonly(),
						"defaultEffort": string().readonly().optional()
					}).readonly().optional()
				})).readonly()
			})).readonly(),
			"failures": array(object({
				"id": string().readonly(),
				"name": string().readonly(),
				"message": string().readonly()
			})).readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_openWorkspacePath_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_openWorkspacePath_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_openWorkspacePath_parameter_0$schema$value ??= object({
			"action": literal("reveal").readonly().optional(),
			"application": string().readonly().optional(),
			"path": string().readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_openWorkspacePath_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_openWorkspacePath_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_openWorkspacePath_result$schema$value ??= object({ "opened": literal(true).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_page_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_page_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_page_parameter_0$schema$value ??= object({
			"address": union([object({
				"kind": literal("session").readonly(),
				"sessionId": intersection(string(), unknown()).readonly()
			}), object({
				"kind": literal("subagent").readonly(),
				"parentSessionId": intersection(string(), unknown()).readonly(),
				"childSessionId": intersection(string(), unknown()).readonly(),
				"mode": union([
					literal("one-shot"),
					literal("continuable"),
					literal("unknown")
				]).readonly()
			})]).readonly(),
			"throughSeq": number().readonly(),
			"beforeSeq": number().readonly().optional(),
			"maxMessages": number().readonly().optional(),
			"turnWindow": object({
				"minMessages": number().readonly(),
				"minTurns": number().readonly()
			}).readonly().optional()
		});
		let _deepseek_ai_dsh_api_session_controller_session_page_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_page_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_page_result$schema$value ??= object({
			"records": array(object({
				"type": literal("event").readonly(),
				"event": object({
					"type": string().readonly(),
					"seq": number().readonly(),
					"time": number().readonly(),
					"data": union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema2())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema2()))
					]).readonly(),
					"ignorable": literal(true).readonly().optional(),
					"sourceEventSeqs": union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema2())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema2()))
					]).readonly().optional(),
					"surfaceOp": union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema2())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema2()))
					]).readonly().optional()
				}).readonly()
			})).readonly(),
			"hasMore": boolean().readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_projections_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_projections_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_projections_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_projections_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_projections_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_projections_result$schema$value ??= union([literal(null), object({
			"asOfSeq": number().readonly(),
			"values": intersection(object({
				"inbox": object({
					"next-turn": array(union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema4())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema4()))
					])).readonly(),
					"next-step": array(union([
						literal(null),
						string(),
						number(),
						literal(false),
						literal(true),
						array(lazy(() => JsonValueRemoteCodec$schema4())),
						record(string(), lazy(() => JsonValueRemoteCodec$schema4()))
					])).readonly()
				}).optional(),
				"agentPreset": union([literal(null), string()]).optional(),
				"title": union([literal(null), string()]).optional(),
				"todos": union([literal(null), array(object({
					"content": string(),
					"status": union([
						literal("completed"),
						literal("pending"),
						literal("in_progress")
					])
				}))]).optional(),
				"sessionListMetadata": object({
					"blank": boolean().readonly(),
					"lastPromptAt": union([literal(null), number()]).readonly()
				}).optional(),
				"imageLimits": object({
					"maxImageBytes": number(),
					"maxImagesPerMessage": number(),
					"maxMessageImageBytes": number(),
					"maxImagePixels": number(),
					"maxImageDimension": number(),
					"mediaTypes": array(union([
						literal("image/png"),
						literal("image/jpeg"),
						literal("image/webp"),
						literal("image/gif")
					]))
				}).optional(),
				"modelSelection": object({
					"lastUsed": union([literal(null), object({
						"provider": string().readonly(),
						"model": string().readonly(),
						"reasoningEffort": string().readonly().optional()
					})]).readonly(),
					"next": union([literal(null), object({
						"provider": string().readonly(),
						"model": string().readonly(),
						"reasoningEffort": string().readonly().optional()
					})]).readonly()
				}).optional(),
				"permissions": object({ "currentValue": string() }).optional(),
				"subagentCatalog": array(union([
					intersection(object({
						"id": intersection(string(), unknown()).readonly(),
						"createdAt": number().readonly()
					}), object({
						"mode": literal("one-shot").readonly(),
						"label": string().readonly().optional()
					})),
					intersection(object({
						"id": intersection(string(), unknown()).readonly(),
						"createdAt": number().readonly()
					}), object({
						"mode": literal("continuable").readonly(),
						"label": string().readonly()
					})),
					intersection(object({
						"id": intersection(string(), unknown()).readonly(),
						"createdAt": number().readonly()
					}), object({
						"mode": literal("unknown").readonly(),
						"label": string().readonly().optional()
					}))
				])).optional(),
				"subagentTiming": object({
					"settledMs": number(),
					"active": object({
						"since": number(),
						"through": number()
					}).optional(),
					"lastTurnCompleted": boolean().optional()
				}).optional(),
				"subagent": union([
					literal(null),
					object({
						"mode": literal("one-shot"),
						"label": string().optional(),
						"seq": intersection(number(), unknown())
					}),
					object({
						"mode": literal("continuable"),
						"label": string(),
						"seq": intersection(number(), unknown())
					})
				]).optional(),
				"tokenUsage": object({
					"uncachedInputTokens": number(),
					"outputTokens": number(),
					"cacheReadTokens": number(),
					"cacheWriteTokens": number()
				}).optional(),
				"contextPressure": object({
					"pressureTokens": number().optional(),
					"projectedTokens": number().optional(),
					"contextWindow": number().optional()
				}).optional(),
				"contextBreakdown": object({
					"systemTokens": number(),
					"toolsTokens": number(),
					"messageTokens": number()
				}).optional(),
				"userQuestions": object({
					"active": array(object({
						"callId": intersection(string(), unknown()).readonly(),
						"questions": array(object({
							"id": string(),
							"question": string(),
							"detail": string().optional(),
							"header": string().optional(),
							"options": array(object({
								"label": string(),
								"description": string().optional()
							})).optional(),
							"multiSelect": boolean().optional(),
							"intent": object({
								"kind": literal("plan-review"),
								"approve": string(),
								"callId": intersection(string(), unknown()).optional()
							}).optional()
						})).readonly(),
						"state": union([literal("open"), literal("continued")]).readonly()
					})).readonly(),
					"settled": array(object({
						"callId": intersection(string(), unknown()).readonly(),
						"answers": array(object({
							"id": string(),
							"selected": array(string()),
							"custom": string().optional()
						})).readonly()
					})).readonly()
				}).optional(),
				"goal": union([literal(null), object({
					"goal": object({
						"objective": string().readonly(),
						"phase": union([
							literal("active"),
							literal("paused"),
							literal("blocked"),
							literal("complete")
						]).readonly(),
						"blockedReason": object({
							"code": string().readonly(),
							"message": string().readonly()
						}).readonly().optional(),
						"maxGoalRounds": number().readonly(),
						"id": intersection(string(), unknown()).readonly(),
						"revision": number().readonly()
					}).readonly(),
					"roundsStarted": number().readonly(),
					"createdAt": number().readonly(),
					"updatedAt": number().readonly()
				})]).optional()
			}), record(string(), union([
				literal(null),
				string(),
				number(),
				literal(false),
				literal(true),
				array(lazy(() => JsonValueRemoteCodec$schema4())),
				record(string(), lazy(() => JsonValueRemoteCodec$schema4()))
			])).readonly()).readonly()
		})]);
		let _deepseek_ai_dsh_api_session_controller_session_prompt_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_prompt_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_prompt_parameter_0$schema$value ??= object({
			"requestId": intersection(string(), unknown()).readonly(),
			"sessionId": intersection(string(), unknown()).readonly(),
			"mode": union([literal("queue"), literal("steer")]).readonly(),
			"content": array(union([
				object({
					"type": literal("text").readonly(),
					"text": string().readonly()
				}),
				object({
					"type": literal("image").readonly(),
					"mediaType": union([
						literal("image/png"),
						literal("image/jpeg"),
						literal("image/webp"),
						literal("image/gif")
					]).readonly(),
					"data": string().readonly(),
					"name": string().readonly().optional()
				}),
				object({
					"type": literal("file").readonly(),
					"receiptId": intersection(string(), unknown()).readonly()
				})
			])).readonly(),
			"clientTimeZone": string().readonly().optional()
		});
		let _deepseek_ai_dsh_api_session_controller_session_prompt_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_prompt_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_prompt_result$schema$value ??= object({ "accepted": literal(true).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_rename_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_rename_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_rename_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"title": string().readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_rename_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_rename_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_rename_result$schema$value ??= object({
			"title": string().readonly(),
			"seq": number().readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_search_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_search_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_search_parameter_0$schema$value ??= object({ "query": string().readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_search_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_search_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_search_result$schema$value ??= object({
			"items": array(object({
				"sessionId": intersection(string(), unknown()).readonly(),
				"snippet": string().readonly()
			})).readonly(),
			"hasMore": boolean().readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_selectModel_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_selectModel_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_selectModel_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"provider": string().readonly(),
			"model": string().readonly(),
			"reasoningEffort": string().readonly().optional()
		});
		let _deepseek_ai_dsh_api_session_controller_session_selectModel_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_selectModel_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_selectModel_result$schema$value ??= object({ "selected": object({
			"provider": string().readonly(),
			"model": string().readonly(),
			"reasoningEffort": string().readonly().optional()
		}).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_updateQueue_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_updateQueue_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_updateQueue_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"itemId": intersection(string(), unknown()).readonly(),
			"action": union([
				object({
					"kind": literal("edit").readonly(),
					"content": array(object({
						"type": literal("text"),
						"text": string()
					})).readonly()
				}),
				object({ "kind": literal("remove").readonly() }),
				object({ "kind": literal("steer").readonly() })
			]).readonly()
		});
		let _deepseek_ai_dsh_api_session_controller_session_updateQueue_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_updateQueue_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_updateQueue_result$schema$value ??= object({ "accepted": literal(true).readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_workspacePathApplications_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_workspacePathApplications_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_session_workspacePathApplications_parameter_0$schema$value ??= object({ "path": string().readonly() });
		let _deepseek_ai_dsh_api_session_controller_session_workspacePathApplications_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_session_workspacePathApplications_result$schema = () => _deepseek_ai_dsh_api_session_controller_session_workspacePathApplications_result$schema$value ??= array(object({
			"id": string().readonly(),
			"name": string().readonly(),
			"default": boolean().readonly(),
			"icon": union([literal(null), string()]).readonly()
		}));
		let _deepseek_ai_dsh_api_session_controller_skills_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_session_controller_skills_list_parameter_0$schema = () => _deepseek_ai_dsh_api_session_controller_skills_list_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_session_controller_skills_list_result$schema$value;
		const _deepseek_ai_dsh_api_session_controller_skills_list_result$schema = () => _deepseek_ai_dsh_api_session_controller_skills_list_result$schema$value ??= object({ "skills": array(object({
			"path": string().readonly().optional(),
			"name": string().readonly(),
			"description": string().readonly(),
			"whenToUse": string().readonly().optional(),
			"modelInvocable": boolean().readonly()
		})).readonly() });
		const TYPERT_REMOTE$4 = {
			package: "@deepseek-ai/dsh-api-session-controller",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-api-session-controller#fileReferences/list",
					service: "sessionFileReferences",
					namespace: "fileReferences",
					method: "list",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_session_controller_fileReferences_list_parameter_0$schema
						}
					}, {
						name: "query",
						wire: "query",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller#fileReferences/list:query",
							create: _deepseek_ai_dsh_api_session_controller_fileReferences_list_parameter_1$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller#fileReferences/list:result",
						create: _deepseek_ai_dsh_api_session_controller_fileReferences_list_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/file-references.ts",
						"line": 33,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/attachment",
					service: "sessionController",
					namespace: "session",
					method: "attachment",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionAttachmentRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_attachment_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionAttachmentValue",
						create: _deepseek_ai_dsh_api_session_controller_session_attachment_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 444,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/cancel",
					service: "sessionController",
					namespace: "session",
					method: "cancel",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionCancelRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_cancel_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionCancelValue",
						create: _deepseek_ai_dsh_api_session_controller_session_cancel_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 464,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/canOpenWorkspacePath",
					service: "sessionController",
					namespace: "session",
					method: "canOpenWorkspacePath",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller#session/canOpenWorkspacePath:result",
						create: _deepseek_ai_dsh_api_session_controller_session_canOpenWorkspacePath_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 326,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/control",
					service: "sessionController",
					namespace: "session",
					method: "control",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionControlFrame",
						create: _deepseek_ai_dsh_api_session_controller_session_control_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 527,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/create",
					service: "sessionController",
					namespace: "session",
					method: "create",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionCreateRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_create_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionCreateValue",
						create: _deepseek_ai_dsh_api_session_controller_session_create_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 280,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/follow",
					service: "sessionController",
					namespace: "session",
					method: "follow",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionFollowRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_follow_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionFollowFrame",
						create: _deepseek_ai_dsh_api_session_controller_session_follow_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 487,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/fork",
					service: "sessionController",
					namespace: "session",
					method: "fork",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionForkRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_fork_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionForkValue",
						create: _deepseek_ai_dsh_api_session_controller_session_fork_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 422,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/initializeDefaultModel",
					service: "sessionController",
					namespace: "session",
					method: "initializeDefaultModel",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller#session/initializeDefaultModel:result",
						create: _deepseek_ai_dsh_api_session_controller_session_initializeDefaultModel_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 299,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/list",
					service: "sessionController",
					namespace: "session",
					method: "list",
					invocation: { kind: "direct" },
					parameters: [{
						name: "_request",
						wire: "_request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionListRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_list_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionListValue",
						create: _deepseek_ai_dsh_api_session_controller_session_list_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 259,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/modelCatalog",
					service: "sessionController",
					namespace: "session",
					method: "modelCatalog",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#ModelCatalog",
						create: _deepseek_ai_dsh_api_session_controller_session_modelCatalog_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 317,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/openWorkspacePath",
					service: "sessionController",
					namespace: "session",
					method: "openWorkspacePath",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionOpenWorkspacePathRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_openWorkspacePath_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionOpenWorkspacePathValue",
						create: _deepseek_ai_dsh_api_session_controller_session_openWorkspacePath_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 347,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/page",
					service: "sessionController",
					namespace: "session",
					method: "page",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionPageRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_page_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionPage",
						create: _deepseek_ai_dsh_api_session_controller_session_page_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 475,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/projections",
					service: "sessionController",
					namespace: "session",
					method: "projections",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionProjectionsRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_projections_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionProjectionsValue",
						create: _deepseek_ai_dsh_api_session_controller_session_projections_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 498,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/prompt",
					service: "sessionController",
					namespace: "session",
					method: "prompt",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionPromptRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_prompt_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionPromptValue",
						create: _deepseek_ai_dsh_api_session_controller_session_prompt_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 433,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/rename",
					service: "sessionController",
					namespace: "session",
					method: "rename",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionRenameRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_rename_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionRenameValue",
						create: _deepseek_ai_dsh_api_session_controller_session_rename_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 410,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/search",
					service: "sessionController",
					namespace: "session",
					method: "search",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionSearchRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_search_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionSearchValue",
						create: _deepseek_ai_dsh_api_session_controller_session_search_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 270,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/selectModel",
					service: "sessionController",
					namespace: "session",
					method: "selectModel",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionSelectModelRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_selectModel_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionSelectModelValue",
						create: _deepseek_ai_dsh_api_session_controller_session_selectModel_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 290,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/updateQueue",
					service: "sessionController",
					namespace: "session",
					method: "updateQueue",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionUpdateQueueRequest",
							create: _deepseek_ai_dsh_api_session_controller_session_updateQueue_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SessionUpdateQueueValue",
						create: _deepseek_ai_dsh_api_session_controller_session_updateQueue_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 454,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#session/workspacePathApplications",
					service: "sessionController",
					namespace: "session",
					method: "workspacePathApplications",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller#session/workspacePathApplications:request",
							create: _deepseek_ai_dsh_api_session_controller_session_workspacePathApplications_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller#session/workspacePathApplications:result",
						create: _deepseek_ai_dsh_api_session_controller_session_workspacePathApplications_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/index.ts",
						"line": 377,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-session-controller#skills/list",
					service: "sessionSkillCatalog",
					namespace: "skills",
					method: "list",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SkillListRequest",
							create: _deepseek_ai_dsh_api_session_controller_skills_list_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-session-controller/types#SkillListValue",
						create: _deepseek_ai_dsh_api_session_controller_skills_list_result$schema
					},
					sourceLocation: {
						"file": "packages/api/session-controller/src/skill-catalog.ts",
						"line": 35,
						"column": 9
					}
				}
			]
		};
		//#endregion
		//#region ../job-controller/lib/typert.remote-client.js
		let _deepseek_ai_dsh_api_job_controller_job_follow_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_job_controller_job_follow_parameter_0$schema = () => _deepseek_ai_dsh_api_job_controller_job_follow_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly().optional(),
			"jobId": intersection(string(), unknown()).readonly(),
			"from": number().readonly().optional()
		});
		let _deepseek_ai_dsh_api_job_controller_job_follow_result$schema$value;
		const _deepseek_ai_dsh_api_job_controller_job_follow_result$schema = () => _deepseek_ai_dsh_api_job_controller_job_follow_result$schema$value ??= union([
			object({
				"type": literal("opened").readonly(),
				"job": object({
					"id": intersection(string(), unknown()).readonly(),
					"kind": string().readonly(),
					"label": string().readonly(),
					"owner": intersection(string(), unknown()).readonly().optional(),
					"outputLimitBytes": number().readonly().optional(),
					"status": union([
						literal("failed"),
						literal("running"),
						literal("stopping"),
						literal("completed"),
						literal("killed")
					]).readonly(),
					"progress": string().readonly().optional(),
					"detail": string().readonly().optional(),
					"startedAt": number().readonly(),
					"finishedAt": number().readonly().optional(),
					"output": object({
						"total": number().readonly(),
						"earliest": number().readonly(),
						"spillPaths": array(string()).readonly().optional()
					}).readonly()
				}).readonly(),
				"from": number().readonly()
			}),
			object({
				"type": literal("output").readonly(),
				"chunks": array(object({
					"at": number().readonly(),
					"text": string().readonly(),
					"channel": union([
						literal("stdout"),
						literal("stderr"),
						literal("log")
					]).readonly().optional(),
					"gapBefore": literal(true).readonly().optional()
				})).readonly(),
				"next": number().readonly(),
				"lossy": literal(true).readonly().optional()
			}),
			object({
				"type": literal("status").readonly(),
				"job": object({
					"id": intersection(string(), unknown()).readonly(),
					"kind": string().readonly(),
					"label": string().readonly(),
					"owner": intersection(string(), unknown()).readonly().optional(),
					"outputLimitBytes": number().readonly().optional(),
					"status": union([
						literal("failed"),
						literal("running"),
						literal("stopping"),
						literal("completed"),
						literal("killed")
					]).readonly(),
					"progress": string().readonly().optional(),
					"detail": string().readonly().optional(),
					"startedAt": number().readonly(),
					"finishedAt": number().readonly().optional(),
					"output": object({
						"total": number().readonly(),
						"earliest": number().readonly(),
						"spillPaths": array(string()).readonly().optional()
					}).readonly()
				}).readonly()
			})
		]);
		let _deepseek_ai_dsh_api_job_controller_job_kill_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_job_controller_job_kill_parameter_0$schema = () => _deepseek_ai_dsh_api_job_controller_job_kill_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"jobId": intersection(string(), unknown()).readonly()
		});
		let _deepseek_ai_dsh_api_job_controller_job_kill_result$schema$value;
		const _deepseek_ai_dsh_api_job_controller_job_kill_result$schema = () => _deepseek_ai_dsh_api_job_controller_job_kill_result$schema$value ??= object({ "outcome": union([literal("requested"), literal("already-finished")]).readonly() });
		let _deepseek_ai_dsh_api_job_controller_job_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_job_controller_job_list_parameter_0$schema = () => _deepseek_ai_dsh_api_job_controller_job_list_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_job_controller_job_list_result$schema$value;
		const _deepseek_ai_dsh_api_job_controller_job_list_result$schema = () => _deepseek_ai_dsh_api_job_controller_job_list_result$schema$value ??= object({
			"type": literal("rows").readonly(),
			"jobs": array(object({
				"id": intersection(string(), unknown()).readonly(),
				"kind": string().readonly(),
				"label": string().readonly(),
				"owner": intersection(string(), unknown()).readonly().optional(),
				"outputLimitBytes": number().readonly().optional(),
				"status": union([
					literal("failed"),
					literal("running"),
					literal("stopping"),
					literal("completed"),
					literal("killed")
				]).readonly(),
				"progress": string().readonly().optional(),
				"detail": string().readonly().optional(),
				"startedAt": number().readonly(),
				"finishedAt": number().readonly().optional(),
				"output": object({
					"total": number().readonly(),
					"earliest": number().readonly(),
					"spillPaths": array(string()).readonly().optional()
				}).readonly()
			})).readonly()
		});
		const TYPERT_REMOTE$3 = {
			package: "@deepseek-ai/dsh-api-job-controller",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-api-job-controller#job/follow",
					service: "jobController",
					namespace: "job",
					method: "follow",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-job-controller/types#JobFollowRequest",
							create: _deepseek_ai_dsh_api_job_controller_job_follow_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-job-controller/types#JobFollowFrame",
						create: _deepseek_ai_dsh_api_job_controller_job_follow_result$schema
					},
					sourceLocation: {
						"file": "packages/api/job-controller/src/index.ts",
						"line": 91,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-job-controller#job/kill",
					service: "jobController",
					namespace: "job",
					method: "kill",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-job-controller/types#JobKillRequest",
							create: _deepseek_ai_dsh_api_job_controller_job_kill_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-job-controller/types#JobKillValue",
						create: _deepseek_ai_dsh_api_job_controller_job_kill_result$schema
					},
					sourceLocation: {
						"file": "packages/api/job-controller/src/index.ts",
						"line": 110,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-job-controller#job/list",
					service: "jobController",
					namespace: "job",
					method: "list",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-job-controller/types#JobListRequest",
							create: _deepseek_ai_dsh_api_job_controller_job_list_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-job-controller/types#JobListFrame",
						create: _deepseek_ai_dsh_api_job_controller_job_list_result$schema
					},
					sourceLocation: {
						"file": "packages/api/job-controller/src/index.ts",
						"line": 76,
						"column": 3
					}
				}
			]
		};
		//#endregion
		//#region ../workspace-controller/lib/typert.remote-client.js
		let _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_0$schema$value ??= string();
		let _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_1$schema = () => _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_result$schema$value ??= string();
		let _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_parameter_0$schema$value ??= union([_undefined(), string()]);
		let _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_result$schema$value ??= object({
			"path": string(),
			"home": string(),
			"crumbs": array(object({
				"name": string(),
				"path": string(),
				"hidden": boolean()
			})),
			"entries": array(object({
				"name": string(),
				"path": string(),
				"hidden": boolean()
			})),
			"truncated": boolean()
		});
		let _deepseek_ai_dsh_api_workspace_controller_directoryPicker_pick_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_directoryPicker_pick_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_directoryPicker_pick_result$schema$value ??= union([literal(null), string()]);
		let _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema$value ??= object({
			"sessionId": intersection(string(), unknown()).readonly(),
			"stopActivity": boolean().readonly().optional()
		});
		let _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema$value ??= object({ "archivedSessionIds": array(intersection(string(), unknown())).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_create_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_create_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_create_parameter_0$schema$value ??= object({ "path": string().readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_create_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_create_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_create_result$schema$value ??= object({
			"workspace": object({
				"workspaceId": intersection(string(), unknown()).readonly(),
				"path": string().readonly(),
				"title": string().readonly(),
				"sessionIds": array(intersection(string(), unknown())).readonly(),
				"createdAt": string().readonly(),
				"updatedAt": string().readonly()
			}).readonly(),
			"created": boolean().readonly()
		});
		let _deepseek_ai_dsh_api_workspace_controller_workspace_delete_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_delete_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_delete_parameter_0$schema$value ??= object({ "workspaceId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_delete_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_delete_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_delete_result$schema$value ??= object({ "deleted": literal(true).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_follow_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_follow_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_follow_result$schema$value ??= union([
			object({
				"type": literal("baseline").readonly(),
				"value": object({
					"items": array(object({
						"workspaceId": intersection(string(), unknown()).readonly(),
						"path": string().readonly(),
						"title": string().readonly(),
						"sessionIds": array(intersection(string(), unknown())).readonly(),
						"createdAt": string().readonly(),
						"updatedAt": string().readonly()
					})).readonly(),
					"archivedSessionIds": array(intersection(string(), unknown())).readonly(),
					"pinnedSessionIds": array(intersection(string(), unknown())).readonly()
				}).readonly()
			}),
			object({
				"type": literal("upsert").readonly(),
				"workspace": object({
					"workspaceId": intersection(string(), unknown()).readonly(),
					"path": string().readonly(),
					"title": string().readonly(),
					"sessionIds": array(intersection(string(), unknown())).readonly(),
					"createdAt": string().readonly(),
					"updatedAt": string().readonly()
				}).readonly()
			}),
			object({
				"type": literal("remove").readonly(),
				"workspaceId": intersection(string(), unknown()).readonly()
			}),
			object({
				"type": literal("order").readonly(),
				"workspaceIds": array(intersection(string(), unknown())).readonly()
			}),
			object({
				"type": literal("archived").readonly(),
				"archivedSessionIds": array(intersection(string(), unknown())).readonly()
			}),
			object({
				"type": literal("pinned").readonly(),
				"pinnedSessionIds": array(intersection(string(), unknown())).readonly()
			})
		]);
		let _deepseek_ai_dsh_api_workspace_controller_workspace_initializeDefault_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_initializeDefault_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_initializeDefault_result$schema$value ??= union([_undefined(), object({ "workspace": object({
			"workspaceId": intersection(string(), unknown()).readonly(),
			"path": string().readonly(),
			"title": string().readonly(),
			"sessionIds": array(intersection(string(), unknown())).readonly(),
			"createdAt": string().readonly(),
			"updatedAt": string().readonly()
		}).readonly() })]);
		let _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_parameter_0$schema$value ??= object({
			"workspaceId": intersection(string(), unknown()).readonly(),
			"beforeWorkspaceId": intersection(string(), unknown()).readonly().optional()
		});
		let _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_result$schema$value ??= object({ "workspaceIds": array(intersection(string(), unknown())).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_parameter_0$schema$value ??= object({
			"workspaceId": intersection(string(), unknown()).readonly(),
			"sessionId": intersection(string(), unknown()).readonly(),
			"beforeSessionId": intersection(string(), unknown()).readonly().optional()
		});
		let _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_result$schema$value ??= object({ "workspace": object({
			"workspaceId": intersection(string(), unknown()).readonly(),
			"path": string().readonly(),
			"title": string().readonly(),
			"sessionIds": array(intersection(string(), unknown())).readonly(),
			"createdAt": string().readonly(),
			"updatedAt": string().readonly()
		}).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_result$schema$value ??= object({ "pinnedSessionIds": array(intersection(string(), unknown())).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_rename_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_rename_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_rename_parameter_0$schema$value ??= object({
			"workspaceId": intersection(string(), unknown()).readonly(),
			"title": string().readonly()
		});
		let _deepseek_ai_dsh_api_workspace_controller_workspace_rename_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_rename_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_rename_result$schema$value ??= object({ "workspace": object({
			"workspaceId": intersection(string(), unknown()).readonly(),
			"path": string().readonly(),
			"title": string().readonly(),
			"sessionIds": array(intersection(string(), unknown())).readonly(),
			"createdAt": string().readonly(),
			"updatedAt": string().readonly()
		}).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema$value ??= object({ "archivedSessionIds": array(intersection(string(), unknown())).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });
		let _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema$value ??= object({ "pinnedSessionIds": array(intersection(string(), unknown())).readonly() });
		const TYPERT_REMOTE$2 = {
			package: "@deepseek-ai/dsh-api-workspace-controller",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory",
					service: "directoryPickerController",
					namespace: "directoryPicker",
					method: "createDirectory",
					invocation: { kind: "direct" },
					parameters: [{
						name: "path",
						wire: "path",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:path",
							create: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_0$schema
						}
					}, {
						name: "name",
						wire: "name",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:name",
							create: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:result",
						create: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/directory-picker.ts",
						"line": 88,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/list",
					service: "directoryPickerController",
					namespace: "directoryPicker",
					method: "list",
					invocation: { kind: "direct" },
					parameters: [{
						name: "path",
						wire: "path",
						source: "json",
						acceptsUndefined: true,
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/list:path",
							create: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-host-directory-picker/types#DirectoryListing",
						create: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/directory-picker.ts",
						"line": 72,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/pick",
					service: "directoryPickerController",
					namespace: "directoryPicker",
					method: "pick",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/pick:result",
						create: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_pick_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/directory-picker.ts",
						"line": 55,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/archiveSession",
					service: "workspaceController",
					namespace: "workspace",
					method: "archiveSession",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveSessionRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 155,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/create",
					service: "workspaceController",
					namespace: "workspace",
					method: "create",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceCreateRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_create_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceCreateValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_create_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 86,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/delete",
					service: "workspaceController",
					namespace: "workspace",
					method: "delete",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_delete_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_delete_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 125,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/follow",
					service: "workspaceController",
					namespace: "workspace",
					method: "follow",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceFollowFrame",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_follow_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 195,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/initializeDefault",
					service: "workspaceController",
					namespace: "workspace",
					method: "initializeDefault",
					invocation: { kind: "direct" },
					parameters: [],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller#workspace/initializeDefault:result",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_initializeDefault_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 99,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/insertBefore",
					service: "workspaceController",
					namespace: "workspace",
					method: "insertBefore",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceInsertBeforeRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceOrderValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 135,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/insertSessionBefore",
					service: "workspaceController",
					namespace: "workspace",
					method: "insertSessionBefore",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceInsertSessionBeforeRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 145,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/pinSession",
					service: "workspaceController",
					namespace: "workspace",
					method: "pinSession",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinSessionRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 175,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/rename",
					service: "workspaceController",
					namespace: "workspace",
					method: "rename",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceRenameRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_rename_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_rename_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 115,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession",
					service: "workspaceController",
					namespace: "workspace",
					method: "unarchiveSession",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 165,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-controller#workspace/unpinSession",
					service: "workspaceController",
					namespace: "workspace",
					method: "unpinSession",
					invocation: { kind: "direct" },
					parameters: [{
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnpinSessionRequest",
							create: _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinValue",
						create: _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-controller/src/index.ts",
						"line": 185,
						"column": 3
					}
				}
			]
		};
		//#endregion
		//#region ../terminal-controller/lib/typert.remote-client.js
		let _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema$value ??= _void();
		let _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema$value ??= object({
			"shellPath": string().readonly().optional(),
			"id": intersection(string(), unknown()).readonly(),
			"cols": number().readonly(),
			"rows": number().readonly()
		});
		let _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema$value ??= object({
			"id": intersection(string(), unknown()).readonly(),
			"title": string().readonly(),
			"shell": object({
				"path": string().readonly(),
				"args": array(string()).readonly(),
				"name": string().readonly()
			}).readonly(),
			"cwd": string().readonly(),
			"cols": number().readonly(),
			"rows": number().readonly(),
			"state": union([
				literal("failed"),
				literal("running"),
				literal("exited")
			]).readonly(),
			"exitCode": union([literal(null), number()]).readonly(),
			"error": string().readonly().optional(),
			"controllerId": intersection(string(), unknown()).readonly().optional()
		});
		let _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema$value ??= object({
			"cwd": string().readonly(),
			"maxInputBytes": number().readonly(),
			"maxCols": number().readonly(),
			"maxRows": number().readonly(),
			"scrollback": number().readonly()
		});
		let _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema$value ??= union([
			object({
				"type": literal("snapshot").readonly(),
				"sequence": number().readonly(),
				"screen": string().readonly(),
				"info": object({
					"id": intersection(string(), unknown()).readonly(),
					"title": string().readonly(),
					"shell": object({
						"path": string().readonly(),
						"args": array(string()).readonly(),
						"name": string().readonly()
					}).readonly(),
					"cwd": string().readonly(),
					"cols": number().readonly(),
					"rows": number().readonly(),
					"state": union([
						literal("failed"),
						literal("running"),
						literal("exited")
					]).readonly(),
					"exitCode": union([literal(null), number()]).readonly(),
					"error": string().readonly().optional(),
					"controllerId": intersection(string(), unknown()).readonly().optional()
				}).readonly()
			}),
			object({
				"type": literal("output").readonly(),
				"sequence": number().readonly(),
				"data": string().readonly()
			}),
			object({
				"type": literal("state").readonly(),
				"info": object({
					"id": intersection(string(), unknown()).readonly(),
					"title": string().readonly(),
					"shell": object({
						"path": string().readonly(),
						"args": array(string()).readonly(),
						"name": string().readonly()
					}).readonly(),
					"cwd": string().readonly(),
					"cols": number().readonly(),
					"rows": number().readonly(),
					"state": union([
						literal("failed"),
						literal("running"),
						literal("exited")
					]).readonly(),
					"exitCode": union([literal(null), number()]).readonly(),
					"error": string().readonly().optional(),
					"controllerId": intersection(string(), unknown()).readonly().optional()
				}).readonly()
			})
		]);
		let _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema$value ??= array(object({
			"id": intersection(string(), unknown()).readonly(),
			"title": string().readonly(),
			"shell": object({
				"path": string().readonly(),
				"args": array(string()).readonly(),
				"name": string().readonly()
			}).readonly(),
			"cwd": string().readonly(),
			"cols": number().readonly(),
			"rows": number().readonly(),
			"state": union([
				literal("failed"),
				literal("running"),
				literal("exited")
			]).readonly(),
			"exitCode": union([literal(null), number()]).readonly(),
			"error": string().readonly().optional(),
			"controllerId": intersection(string(), unknown()).readonly().optional()
		}));
		let _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_2$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_2$schema$value ??= string();
		let _deepseek_ai_dsh_api_terminal_controller_terminal_rename_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_rename_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_rename_result$schema$value ??= _void();
		let _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_2$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_2$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_3$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_3$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_3$schema$value ??= number();
		let _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_4$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_4$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_4$schema$value ??= number();
		let _deepseek_ai_dsh_api_terminal_controller_terminal_resize_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_resize_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_resize_result$schema$value ??= _void();
		let _deepseek_ai_dsh_api_terminal_controller_terminal_retain_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_retain_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_retain_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_retain_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_retain_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_retain_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_retain_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_retain_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_retain_result$schema$value ??= object({ "type": literal("retained").readonly() });
		let _deepseek_ai_dsh_api_terminal_controller_terminal_shells_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_shells_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_shells_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_shells_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_shells_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_shells_result$schema$value ??= array(object({
			"path": string().readonly(),
			"args": array(string()).readonly(),
			"name": string().readonly()
		}));
		let _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_1$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_2$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_2$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_3$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_3$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_3$schema$value ??= string();
		let _deepseek_ai_dsh_api_terminal_controller_terminal_write_result$schema$value;
		const _deepseek_ai_dsh_api_terminal_controller_terminal_write_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_write_result$schema$value ??= _void();
		const TYPERT_REMOTE$1 = {
			package: "@deepseek-ai/dsh-api-terminal-controller",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/close",
					service: "terminalController",
					namespace: "terminal",
					method: "close",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema
						}
					}, {
						name: "id",
						wire: "id",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#WebTerminalId",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/close:result",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 269,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/create",
					service: "terminalController",
					namespace: "terminal",
					method: "create",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema
						}
					}, {
						name: "request",
						wire: "request",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#TerminalCreateRequest",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#WebTerminalInfo",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 158,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/environment",
					service: "terminalController",
					namespace: "terminal",
					method: "environment",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#TerminalEnvironment",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 118,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/follow",
					service: "terminalController",
					namespace: "terminal",
					method: "follow",
					mode: "stream",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema
							}
						},
						{
							name: "id",
							wire: "id",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#WebTerminalId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema
							}
						},
						{
							name: "attachmentId",
							wire: "attachmentId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#TerminalAttachmentId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema
							}
						}
					],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#TerminalFrame",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 216,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/list",
					service: "terminalController",
					namespace: "terminal",
					method: "list",
					invocation: { kind: "direct" },
					parameters: [{
						name: "sessionId",
						wire: "sessionId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/list:result",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 144,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/rename",
					service: "terminalController",
					namespace: "terminal",
					method: "rename",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_0$schema
							}
						},
						{
							name: "id",
							wire: "id",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#WebTerminalId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_1$schema
							}
						},
						{
							name: "title",
							wire: "title",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/rename:title",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_rename_parameter_2$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/rename:result",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_rename_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 257,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/resize",
					service: "terminalController",
					namespace: "terminal",
					method: "resize",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_0$schema
							}
						},
						{
							name: "id",
							wire: "id",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#WebTerminalId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_1$schema
							}
						},
						{
							name: "attachmentId",
							wire: "attachmentId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#TerminalAttachmentId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_2$schema
							}
						},
						{
							name: "cols",
							wire: "cols",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/resize:cols",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_3$schema
							}
						},
						{
							name: "rows",
							wire: "rows",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/resize:rows",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_resize_parameter_4$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/resize:result",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_resize_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 245,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/retain",
					service: "terminalController",
					namespace: "terminal",
					method: "retain",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [{
						name: "sessionId",
						wire: "sessionId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_retain_parameter_0$schema
						}
					}, {
						name: "id",
						wire: "id",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#WebTerminalId",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_retain_parameter_1$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#TerminalRetentionFrame",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_retain_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 198,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/shells",
					service: "terminalController",
					namespace: "terminal",
					method: "shells",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [{
						name: "agent",
						wire: "agentId",
						source: "lookup",
						lookup: "agent",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_terminal_controller_terminal_shells_parameter_0$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/shells:result",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_shells_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 133,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-terminal-controller#terminal/write",
					service: "terminalController",
					namespace: "terminal",
					method: "write",
					invocation: { kind: "direct" },
					scope: {
						context: "agent",
						wire: "agentId"
					},
					parameters: [
						{
							name: "agent",
							wire: "agentId",
							source: "lookup",
							lookup: "agent",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_0$schema
							}
						},
						{
							name: "id",
							wire: "id",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#WebTerminalId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_1$schema
							}
						},
						{
							name: "attachmentId",
							wire: "attachmentId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller/types#TerminalAttachmentId",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_2$schema
							}
						},
						{
							name: "data",
							wire: "data",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/write:data",
								create: _deepseek_ai_dsh_api_terminal_controller_terminal_write_parameter_3$schema
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-terminal-controller#terminal/write:result",
						create: _deepseek_ai_dsh_api_terminal_controller_terminal_write_result$schema
					},
					sourceLocation: {
						"file": "packages/api/terminal-controller/src/index.ts",
						"line": 230,
						"column": 9
					}
				}
			]
		};
		//#endregion
		//#region ../workspace-files/lib/typert.remote-client.js
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_parameter_1$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_result$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_result$schema$value ??= union([object({ "kind": literal("ready").readonly() }), object({
			"kind": literal("change").readonly(),
			"change": union([object({
				"absolutePath": string().readonly(),
				"version": string().readonly()
			}), object({
				"absolutePath": string().readonly(),
				"absent": literal(true).readonly()
			})]).readonly()
		})]);
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_parameter_1$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_result$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_result$schema$value ??= object({
			"path": string().readonly(),
			"entries": array(object({
				"name": string().readonly(),
				"type": union([
					literal("file"),
					literal("directory"),
					literal("other")
				]).readonly(),
				"size": number().readonly().optional()
			})).readonly(),
			"truncated": boolean().readonly()
		});
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_1$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_2$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_2$schema$value ??= object({
			"offset": number().readonly().optional(),
			"limit": number().readonly().optional()
		});
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_result$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_result$schema$value ??= object({
			"offset": number().readonly(),
			"text": string().readonly(),
			"lines": number().readonly(),
			"eof": boolean().readonly(),
			"absolutePath": string().readonly(),
			"version": string().readonly(),
			"bytes": number().readonly().optional()
		});
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_1$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_2$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_2$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_2$schema$value ??= object({
			"range": object({
				"offset": number().readonly().optional(),
				"length": number().readonly().optional()
			}).readonly().optional(),
			"baseFile": string().readonly().optional()
		});
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_result$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_result$schema$value ??= object({
			"offset": number().readonly(),
			"data": _instanceof(Uint8Array),
			"eof": boolean().readonly(),
			"absolutePath": string().readonly(),
			"version": string().readonly(),
			"bytes": number().readonly().optional()
		});
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_parameter_0$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_parameter_0$schema$value ??= intersection(string(), unknown());
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_parameter_1$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_parameter_1$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_parameter_1$schema$value ??= string();
		let _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_result$schema$value;
		const _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_result$schema = () => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_result$schema$value ??= object({
			"absolutePath": string().readonly(),
			"version": string().readonly(),
			"bytes": number().readonly().optional()
		});
		const $resultSnapshot = (input, path) => {
			if (input === null || typeof input !== "object" || input instanceof Uint8Array) return input;
			const toJSON = input.toJSON;
			const value = typeof toJSON === "function" ? toJSON.call(input, path.at(-1)?.toString() ?? "value") : input;
			if (value === null || typeof value !== "object" || value instanceof Uint8Array) return value;
			if (Array.isArray(value)) {
				const items = [];
				for (let index = 0, length = value.length; index < length; index++) items.push(value[index]);
				return items;
			}
			const fields = {};
			for (const key of Object.keys(value)) {
				const item = key === "toJSON" && value === input ? toJSON : value[key];
				if (key === "toJSON" && typeof item === "function") continue;
				Object.defineProperty(fields, key, {
					value: item,
					enumerable: true,
					writable: true,
					configurable: true
				});
			}
			return fields;
		};
		const $resultContainer = (input, path, ancestors, project, snapshot) => {
			if (input === null || typeof input !== "object") return project(input);
			const owner = !ancestors.has(input);
			if (!owner && ancestors.get(input) !== path.length) throw new TypeError("Remote result contains a circular object");
			if (owner) ancestors.set(input, path.length);
			try {
				return project(snapshot ? $resultSnapshot(input, path) : input);
			} finally {
				if (owner) ancestors.delete(input);
			}
		};
		const $encode1 = (value, writeBytes, path, ancestors) => {
			return value instanceof Uint8Array ? writeBytes(value, path) : value;
		};
		const $encode0 = (value, writeBytes, path, ancestors) => {
			return $resultContainer(value, path, ancestors, (value) => {
				if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array) return value;
				if (Object.hasOwn(value, "data")) value["data"] = $encode1(value["data"], writeBytes, [...path, "data"], ancestors);
				return value;
			}, true);
		};
		const TYPERT_REMOTE = {
			package: "@deepseek-ai/dsh-api-workspace-files",
			descriptors: [
				{
					id: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/changes",
					service: "workspaceFiles",
					namespace: "workspaceFiles",
					method: "changes",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [{
						name: "workspaceFileScope",
						wire: "workspaceFileScopeId",
						source: "lookup",
						lookup: "workspaceFileScope",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_parameter_0$schema
						}
					}, {
						name: "path",
						wire: "path",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/changes:path",
							create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_parameter_1$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-files/types#WorkspaceFileWatchFrame",
						create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_changes_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-files/src/index.ts",
						"line": 340,
						"column": 3
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/list",
					service: "workspaceFiles",
					namespace: "workspaceFiles",
					method: "list",
					invocation: { kind: "direct" },
					parameters: [{
						name: "workspaceFileScope",
						wire: "workspaceFileScopeId",
						source: "lookup",
						lookup: "workspaceFileScope",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_parameter_0$schema
						}
					}, {
						name: "path",
						wire: "path",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/list:path",
							create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_parameter_1$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-files/types#WorkspaceDirectoryListing",
						create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_list_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-files/src/index.ts",
						"line": 303,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/read",
					service: "workspaceFiles",
					namespace: "workspaceFiles",
					method: "read",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "workspaceFileScope",
							wire: "workspaceFileScopeId",
							source: "lookup",
							lookup: "workspaceFileScope",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_0$schema
							}
						},
						{
							name: "path",
							wire: "path",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/read:path",
								create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_1$schema
							}
						},
						{
							name: "range",
							wire: "range",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-workspace-files/types#WorkspaceFileRange",
								create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_parameter_2$schema
							}
						}
					],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-files/types#WorkspaceFileText",
						create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_read_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-files/src/index.ts",
						"line": 233,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/readBytes",
					service: "workspaceFiles",
					namespace: "workspaceFiles",
					method: "readBytes",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "workspaceFileScope",
							wire: "workspaceFileScopeId",
							source: "lookup",
							lookup: "workspaceFileScope",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_0$schema
							}
						},
						{
							name: "path",
							wire: "path",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/readBytes:path",
								create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_1$schema
							}
						},
						{
							name: "options",
							wire: "options",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-api-workspace-files/types#WorkspaceByteReadOptions",
								create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_parameter_2$schema
							}
						}
					],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-files/types#WorkspaceFileBytes",
						create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_result$schema,
						decode: (value) => _deepseek_ai_dsh_api_workspace_files_workspaceFiles_readBytes_result$schema().parse(value),
						encode: (value, writeBytes) => $encode0(value, writeBytes, [], /* @__PURE__ */ new Map())
					},
					sourceLocation: {
						"file": "packages/api/workspace-files/src/index.ts",
						"line": 257,
						"column": 9
					}
				},
				{
					id: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/stat",
					service: "workspaceFiles",
					namespace: "workspaceFiles",
					method: "stat",
					invocation: { kind: "direct" },
					parameters: [{
						name: "workspaceFileScope",
						wire: "workspaceFileScopeId",
						source: "lookup",
						lookup: "workspaceFileScope",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_parameter_0$schema
						}
					}, {
						name: "path",
						wire: "path",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-api-workspace-files#workspaceFiles/stat:path",
							create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_parameter_1$schema
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "@deepseek-ai/dsh-api-workspace-files/types#WorkspaceFileStat",
						create: _deepseek_ai_dsh_api_workspace_files_workspaceFiles_stat_result$schema
					},
					sourceLocation: {
						"file": "packages/api/workspace-files/src/index.ts",
						"line": 290,
						"column": 9
					}
				}
			]
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Platform-neutral assembly of generated Host Remote contributions. */
		/** Required service: the typed Client Remote contribution mount. */
		const inject = ["remote"];
		/**
		* Mount the Host capabilities explicitly selected for this Client assembly.
		* @param ctx - Client Cordis root carrying the typed API service.
		* @returns disposer after every selected Remote namespace is ready.
		*/
		async function apply(ctx) {
			const disposers = [];
			try {
				for (const contribution of [
					TYPERT_REMOTE$24,
					TYPERT_REMOTE$23,
					TYPERT_REMOTE$21,
					TYPERT_REMOTE$19,
					TYPERT_REMOTE$20,
					TYPERT_REMOTE$17,
					TYPERT_REMOTE$15,
					TYPERT_REMOTE$14,
					TYPERT_REMOTE$16,
					TYPERT_REMOTE$11,
					TYPERT_REMOTE$13,
					TYPERT_REMOTE$12,
					TYPERT_REMOTE$10,
					TYPERT_REMOTE$8,
					TYPERT_REMOTE$7,
					TYPERT_REMOTE$6,
					TYPERT_REMOTE$9,
					TYPERT_REMOTE$5,
					TYPERT_REMOTE$4,
					TYPERT_REMOTE$3,
					TYPERT_REMOTE$2,
					TYPERT_REMOTE,
					TYPERT_REMOTE$1,
					TYPERT_REMOTE$18,
					TYPERT_REMOTE$22
				]) disposers.push(await ctx.remote.$mount(contribution));
			} catch (error) {
				for (const dispose of disposers.reverse()) await dispose();
				throw error;
			}
			return async () => {
				for (const dispose of disposers.reverse()) await dispose();
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-deliverables",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/types/changes.js
		/** Authenticated GET route serving one announced change summary while its Session lives. */
		const CHANGED_FILES_PATH = "/api/changes.summary";
		/** Authenticated GET route serving one listed file's turn-start and turn-end comparison while its Session lives. */
		const CHANGES_DIFF_PATH = "/api/changes.diff";
		/** Authenticated POST route for opening a changed file on the Host desktop. */
		const CHANGES_OPEN_PATH = "/api/changes.open";
		/**
		* Browser-relative form of {@link CHANGED_FILES_PATH}; see
		* .agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md.
		*/
		const CHANGED_FILES_ROUTE = CHANGED_FILES_PATH.slice(1);
		/** Browser-relative form of {@link CHANGES_DIFF_PATH}. */
		const CHANGES_DIFF_ROUTE = CHANGES_DIFF_PATH.slice(1);
		/** Browser-relative form of {@link CHANGES_OPEN_PATH}. */
		const CHANGES_OPEN_ROUTE = CHANGES_OPEN_PATH.slice(1);
		/** Resource-address prefix of a turn's review tab in the right Sidebar. */
		const CHANGES_REVIEW_ADDRESS = "dsh-resource://changes-review/session/";
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/**
		* Validate one changed-file record read from the summary route.
		* @param value - decoded JSON.
		* @returns whether the record carries a path, a display path, and line counts.
		*/
		function isChangedFile(value) {
			if (!isRecord$1(value)) return false;
			const { path, display, added, deleted, binary, oversized } = value;
			return typeof path === "string" && path.length > 0 && typeof display === "string" && display.length > 0 && Number.isSafeInteger(added) && Number.isSafeInteger(deleted) && (binary === void 0 || binary === true) && (oversized === void 0 || oversized === true);
		}
		/**
		* Validate a summary read from the summary route.
		* @param value - decoded JSON.
		* @returns whether the value identifies a turn, a complete file list, the total count, and the line totals.
		*/
		function isChangesSummary(value) {
			if (!isRecord$1(value)) return false;
			const { turn, files, total, added, deleted } = value;
			return Number.isSafeInteger(turn) && turn >= 1 && Number.isSafeInteger(total) && Number.isSafeInteger(added) && Number.isSafeInteger(deleted) && Array.isArray(files) && files.every(isChangedFile);
		}
		function isHunk(value) {
			if (!isRecord$1(value)) return false;
			const { oldStart, oldLines, newStart, newLines, lines } = value;
			return [
				oldStart,
				oldLines,
				newStart,
				newLines
			].every((field) => Number.isSafeInteger(field) && field >= 0) && Array.isArray(lines) && lines.every((line) => typeof line === "string" && /^[+ -]/.test(line));
		}
		/**
		* Validate a comparison read from the comparison route.
		* @param value - decoded JSON.
		* @returns whether the value is a text comparison with well-formed hunks, or a binary or oversized refusal.
		*/
		function isChangesDiff(value) {
			if (!isRecord$1(value)) return false;
			const { kind, path, display } = value;
			if (typeof path !== "string" || path.length === 0 || typeof display !== "string" || display.length === 0) return false;
			if (kind === "binary" || kind === "oversized") return true;
			if (kind !== "text") return false;
			const { before, after, hunks, coarse } = value;
			return typeof before === "boolean" && typeof after === "boolean" && typeof coarse === "boolean" && Array.isArray(hunks) && hunks.every(isHunk);
		}
		/**
		* Validate the `workspace/changes` event data read from a Session log.
		* @param value - decoded durable event data.
		* @returns whether the event names a turn.
		*/
		function isChangesEvent(value) {
			return isRecord$1(value) && Number.isSafeInteger(value.turn) && value.turn >= 1;
		}
		/**
		* Build authenticated coordinates for the summary one `workspace/changes` event announced.
		* @param sessionId - owning Session.
		* @param seq - event sequence.
		* @returns document-relative summary route.
		*/
		function changesSummaryUrl(sessionId, seq) {
			return `${CHANGED_FILES_ROUTE}?${new URLSearchParams({
				sessionId,
				seq: String(seq)
			})}`;
		}
		/**
		* Build authenticated coordinates for one listed file's comparison.
		* @param sessionId - owning Session.
		* @param seq - workspace/changes event sequence.
		* @param index - original index in the summary's files array.
		* @returns document-relative comparison route.
		*/
		function changesDiffUrl(sessionId, seq, index) {
			return `${CHANGES_DIFF_ROUTE}?${new URLSearchParams({
				sessionId,
				seq: String(seq),
				index: String(index)
			})}`;
		}
		/**
		* Build authenticated coordinates for a changed file's native open.
		* @param sessionId - owning Session.
		* @param seq - workspace/changes event sequence.
		* @param index - original index in the summary's files array.
		* @returns document-relative action route.
		*/
		function changedFileUrl(sessionId, seq, index) {
			return `${CHANGES_OPEN_ROUTE}?${new URLSearchParams({
				sessionId,
				seq: String(seq),
				index: String(index)
			})}`;
		}
		/**
		* The right-Sidebar address of one turn's review. The Session and the event
		* sequence identify the content; the turn rides along for the tab title.
		* @param coordinates - viewed Session, announcing event, and turn.
		* @returns a `dsh-resource://changes-review/session/…` address.
		*/
		function changesReviewAddress(coordinates) {
			const { sessionId, seq, turn } = coordinates;
			return `${CHANGES_REVIEW_ADDRESS}${encodeURIComponent(sessionId)}/${seq}/${turn}`;
		}
		/**
		* Read the coordinates back out of a review address.
		* @param address - a resource address.
		* @returns the coordinates, or undefined for any other address.
		*/
		function parseChangesReviewAddress(address) {
			if (!address.startsWith("dsh-resource://changes-review/session/")) return void 0;
			const parts = address.slice(38).split("/");
			if (parts.length !== 3) return void 0;
			const [sessionId, seq, turn] = parts;
			if (sessionId === "" || !/^\d+$/.test(seq) || !/^[1-9]\d*$/.test(turn)) return void 0;
			try {
				return {
					sessionId: decodeURIComponent(sessionId),
					seq: Number(seq),
					turn: Number(turn)
				};
			} catch {
				return;
			}
		}
		//#endregion
		//#region lib/types/client/host-read-store.js
		/**
		* Fetch-once cache of Host-served records keyed by their authenticated URL:
		* one read per URL while a state stands, cleared on connection replacement,
		* cancelled on disposal. Each store decides what a response means and which
		* states a later request reads again.
		*/
		/** One browser plugin's reads of one record kind. */
		var HostReadStore = class {
			policy;
			/** Record URLs key the state across Sessions and turns. */
			state = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({});
			lifetime = new AbortController();
			/** The connection generation the current states belong to; a reset aborts it so no older read publishes. */
			generation = new AbortController();
			pending = /* @__PURE__ */ new Set();
			constructor(policy) {
				this.policy = policy;
			}
			/**
			* Read one URL unless a state the policy keeps already stands for it.
			* @param url - the record's authenticated URL.
			* @returns after the state is published.
			*/
			async loadUrl(url) {
				const current = this.state.getSnapshot()[url];
				if (this.lifetime.signal.aborted || current !== void 0 && !this.policy.retryable(current)) return;
				this.state.update((state) => {
					state[url] = this.policy.loading;
				});
				const task = this.read(url, AbortSignal.any([this.lifetime.signal, this.generation.signal]));
				this.pending.add(task);
				try {
					await task;
				} finally {
					this.pending.delete(task);
				}
			}
			/** Forget every state and abandon in-flight reads; a replaced connection may reach a Host that no longer serves them. */
			reset() {
				this.generation.abort();
				this.generation = new AbortController();
				this.state.set({});
			}
			/** Cancel outstanding reads and wait until none can publish state. */
			async dispose() {
				this.lifetime.abort();
				await Promise.all(this.pending);
			}
			async read(url, signal) {
				let next;
				try {
					next = await this.policy.decode(await fetch(url, { signal }));
				} catch {
					next = this.policy.failed;
				}
				if (!signal.aborted) this.state.update((state) => {
					state[url] = next;
				});
			}
		};
		//#endregion
		//#region lib/types/client/changes-diff.js
		/** One browser plugin's comparison reads; a failed read is the one state a later request replaces. */
		var ChangesDiffStore = class extends HostReadStore {
			constructor() {
				super({
					loading: "loading",
					failed: "error",
					retryable: (state) => state === "error",
					decode: async (response) => {
						if (response.status === 404) return "missing";
						if (!response.ok) return "error";
						const value = await response.json();
						return isChangesDiff(value) ? value : "error";
					}
				});
			}
			/**
			* Read one comparison; a cached comparison or a missing one is kept, a failed one is read again.
			* @param sessionId - viewed Session.
			* @param seq - the announcing event's sequence.
			* @param index - the file's index in the summary.
			* @returns after the state is published.
			*/
			load(sessionId, seq, index) {
				return this.loadUrl(changesDiffUrl(sessionId, seq, index));
			}
		};
		//#endregion
		//#region lib/types/client/changes-summary.js
		/** One browser plugin's summary reads; a summary or a missing answer is kept until the connection is replaced. */
		var ChangesSummaryStore = class extends HostReadStore {
			constructor() {
				super({
					loading: "loading",
					failed: "missing",
					retryable: () => false,
					decode: async (response) => {
						if (!response.ok) return "missing";
						const value = await response.json();
						return isChangesSummary(value) ? value : "missing";
					}
				});
			}
			/**
			* Read one summary once; a later read of the same coordinates returns the cached state.
			* @param sessionId - viewed Session.
			* @param seq - the announcing event's sequence.
			* @returns after the state is published.
			*/
			load(sessionId, seq) {
				return this.loadUrl(changesSummaryUrl(sessionId, seq));
			}
		};
		//#endregion
		//#region lib/types/presented.js
		/** Authenticated POST route for opening a workspace file on the Host desktop. */
		const PRESENT_OPEN_PATH = "/api/present.open";
		/** Authenticated desktop availability and destination metadata. */
		const PRESENT_HOST_PATH = "/api/present.host";
		/**
		* Browser-relative form of {@link PRESENT_OPEN_PATH}; see
		* .agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md.
		*/
		const PRESENT_OPEN_ROUTE = PRESENT_OPEN_PATH.slice(1);
		/** Browser-relative form of {@link PRESENT_HOST_PATH}. */
		const PRESENT_HOST_ROUTE = PRESENT_HOST_PATH.slice(1);
		/**
		* Validate desktop metadata received over HTTP.
		* @param value - decoded response.
		* @returns whether all displayed and actionable fields are supported.
		*/
		function isPresentedHost(value) {
			if (typeof value !== "object" || value === null) return false;
			const host = value;
			return typeof host.name === "string" && typeof host.available === "boolean" && (host.fileManager === null || host.fileManager === "finder" || host.fileManager === "explorer" || host.fileManager === "directory");
		}
		/**
		* Validate a file declaration read from a Session log.
		* @param value - decoded durable data.
		* @returns whether the declaration contains a path and optional description.
		*/
		function isPresentedFile(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const { path, description } = value;
			return typeof path === "string" && path.trim().length > 0 && (description === void 0 || typeof description === "string");
		}
		/**
		* Build authenticated coordinates for a declared file.
		* @param sessionId - owning Session.
		* @param seq - deliverables/presented event sequence.
		* @param index - original index in the event's files array.
		* @returns document-relative file action route.
		*/
		function presentedFileUrl(sessionId, seq, index) {
			return `${PRESENT_OPEN_ROUTE}?${new URLSearchParams({
				sessionId,
				seq: String(seq),
				index: String(index)
			})}`;
		}
		/**
		* Validate a delivery event before reading its turn or file declarations.
		* @param value - decoded durable event data.
		* @returns whether the event identifies a turn, call, and file list.
		*/
		function isPresentedData(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const { turn, callId, files } = value;
			return typeof turn === "number" && Number.isSafeInteger(turn) && turn >= 1 && typeof callId === "string" && callId.length > 0 && Array.isArray(files);
		}
		/**
		* Trailing path segment, the part that identifies the file at a glance.
		* @param path - Slash- or backslash-separated path.
		* @returns The final segment, or the whole string when separator-free.
		*/
		function basename(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		//#endregion
		//#region lib/types/client/present-open.js
		/** Shared native-open status for delivery cards, the changed-files card, and closing-message file mentions. */
		/** Success feedback remains fully visible for five seconds before fading. */
		const PRESENTED_SUCCESS_HOLD_MS = 5e3;
		/** One browser plugin's file-open requests, cancelled when that plugin is disposed. */
		var PresentedOpenController = class {
			/** File action URLs key the state across Sessions, turns, and both clickable surfaces. */
			state = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({});
			/** Native destination metadata, or a retryable read failure. */
			host = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(null);
			expiry = /* @__PURE__ */ new Map();
			loading;
			metadata = new AbortController();
			lifetime = new AbortController();
			pending = /* @__PURE__ */ new Set();
			/**
			* Open a declared file once while a request for the same coordinates is pending.
			* Failures remain visible on the card and a later gesture retries them.
			* @param sessionId - viewed Session, including a fork's own identity.
			* @param seq - durable delivery event sequence.
			* @param index - original file index within that event.
			* @param action - default application open or file-manager reveal.
			* @param application - registered handler identifier for an explicit application choice.
			* @returns null after a successful handoff, or the failure to announce after publishing card status.
			*/
			open(sessionId, seq, index, action = "open", application) {
				return this.openUrl(presentedFileUrl(sessionId, seq, index), action, application);
			}
			/**
			* Open one recorded changed file in the Host's default application.
			* @param sessionId - viewed Session.
			* @param seq - durable workspace/changes event sequence.
			* @param index - original file index within that event.
			* @param action - application open or file-manager reveal.
			* @param application - registered handler identifier for an explicit application choice.
			* @returns null after a successful handoff, or the failure to announce after publishing card status.
			*/
			openChanged(sessionId, seq, index, action = "open", application) {
				return this.openUrl(changedFileUrl(sessionId, seq, index), action, application);
			}
			async openUrl(url, action, application) {
				const phase = this.state.getSnapshot()[url];
				if (this.lifetime.signal.aborted || phase === "opening" || phase === "revealing") return null;
				this.clearExpiry(url);
				this.state.update((state) => {
					state[url] = action === "open" ? "opening" : "revealing";
				});
				const task = this.request(url, action, application);
				this.pending.add(task);
				try {
					return await task;
				} finally {
					this.pending.delete(task);
				}
			}
			/**
			* Read the serving desktop metadata, coalescing concurrent reads; a later call retries failure.
			* @returns after metadata or a retryable error is published.
			*/
			async loadHost() {
				if (this.lifetime.signal.aborted) return;
				if (this.loading !== void 0) return this.loading;
				this.host.set(null);
				const task = this.readHost(AbortSignal.any([this.lifetime.signal, this.metadata.signal]));
				this.loading = task;
				this.pending.add(task);
				try {
					await task;
				} finally {
					if (this.loading === task) this.loading = void 0;
					this.pending.delete(task);
				}
			}
			/** Invalidate desktop metadata on connection replacement; mounted cards request the new Host. */
			resetHost() {
				const wasLoading = this.loading !== void 0;
				this.metadata.abort();
				this.metadata = new AbortController();
				this.loading = void 0;
				this.host.set(null);
				if (wasLoading) this.loadHost();
			}
			async readHost(signal) {
				let host = "error";
				try {
					const response = await fetch(PRESENT_HOST_ROUTE, { signal });
					if (response.ok) {
						const value = await response.json();
						if (isPresentedHost(value)) host = value;
					}
				} catch {
					host = "error";
				}
				if (!signal.aborted) this.host.set(host);
			}
			/** Cancel outstanding requests and wait until no request can publish state. */
			async dispose() {
				this.lifetime.abort();
				for (const url of this.expiry.keys()) this.clearExpiry(url);
				await Promise.all(this.pending);
			}
			clearExpiry(url) {
				clearTimeout(this.expiry.get(url));
				this.expiry.delete(url);
			}
			async request(url, action, application) {
				const failure = action === "open" ? "error" : "revealError";
				let phase = action === "open" ? "opened" : "revealed";
				try {
					const target = action === "reveal" ? `${url}&action=reveal` : application === void 0 ? url : `${url}&application=${encodeURIComponent(application)}`;
					const response = await fetch(target, {
						method: "POST",
						signal: this.lifetime.signal
					});
					if (!response.ok) phase = response.status === 422 ? "nativeUnavailable" : failure;
				} catch {
					phase = failure;
				}
				if (!this.lifetime.signal.aborted) {
					if (phase === "opened" || phase === "revealed") this.expiry.set(url, setTimeout(() => {
						this.expiry.delete(url);
						this.state.update((state) => {
							Reflect.deleteProperty(state, url);
						});
					}, 5200));
					this.state.update((state) => {
						state[url] = phase;
					});
				}
				return phase === "opened" || phase === "revealed" ? null : action === "reveal" ? "revealError" : "openError";
			}
		};
		//#endregion
		//#region \0dsh-css:D:\deepseek-harness\packages\client\ui-deliverables\src\client\PresentRow.module.css.mjs
		const css$4 = "._4XM2AG_summary{min-width:0;color:inherit;align-items:center;gap:8px;margin-left:8px;font-size:12px;display:flex}._4XM2AG_summary>:first-child{flex-shrink:0}._4XM2AG_paths{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}._4XM2AG_output{border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;padding:12px;font-size:12px}._4XM2AG_inspect{color:var(--dsw-alias-link);font:inherit;cursor:pointer;background:0 0;border:none;align-self:flex-start;padding:4px 0;font-size:12px}";
		const tagId$4 = "@deepseek-ai/dsh-client-ui-deliverables/PresentRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-deliverables";
			tag.dataset.pluginCss = tagId$4;
			tag.textContent = css$4;
			document.head.appendChild(tag);
		}
		var PresentRow_module_css_default = {
			"inspect": "_4XM2AG_inspect",
			"output": "_4XM2AG_output",
			"paths": "_4XM2AG_paths",
			"summary": "_4XM2AG_summary"
		};
		//#endregion
		//#region lib/types/client/PresentRow.js
		/** Present call status and expandable durable result text. */
		/* v8 ignore next -- Non-expandable rows never invoke DisclosureRow's required toggle callback. */
		const noop = () => void 0;
		/** Raw arguments can be partial while a call is streaming. */
		function fileNames(raw) {
			let args;
			try {
				args = JSON.parse(raw);
			} catch {
				return raw;
			}
			if (typeof args !== "object" || args === null || !("files" in args) || !Array.isArray(args.files)) return raw;
			return args.files.flatMap((file) => typeof file === "object" && file !== null && "path" in file && typeof file.path === "string" ? [file.path] : []).join(", ");
		}
		/**
		* Render a present call using its recorded arguments and result.
		* @param props - tool call and localized status copy.
		* @returns a status row with a result disclosure.
		*/
		function PresentRow(props) {
			return props.phase === "preparing" ? (0, react_jsx_runtime.jsx)(PreparingPresentRow, { ...props }) : (0, react_jsx_runtime.jsx)(StartedPresentRow, { ...props });
		}
		function PreparingPresentRow({ t }) {
			return (0, react_jsx_runtime.jsx)("div", {
				"data-tool": "present",
				"data-state": "preparing",
				"aria-label": t("row.preparing"),
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					title: t("row.title"),
					icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDeliverDocRegular, { size: 14 }),
					open: false,
					expandable: false,
					onToggle: noop,
					running: true
				})
			});
		}
		function StartedPresentRow({ block, inspect, t }) {
			const settled = "kind" in block;
			const state = !settled ? "running" : block.error?.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";
			const args = (settled ? block.call?.argsRaw : block.argsRaw) ?? "";
			const details = (settled ? block.content.map((item) => item.type === "text" ? item.text : JSON.stringify(item)).join("\n") : "") || (settled && block.error ? `${block.error.name}: ${block.error.code}` : "");
			const [expanded, setExpanded] = (0, react.useState)(false);
			return (0, react_jsx_runtime.jsx)("div", {
				"data-tool": "present",
				"data-state": state,
				children: (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					title: t("row.title"),
					icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDeliverDocRegular, { size: 14 }),
					open: expanded && details !== "",
					expandable: details !== "",
					expandOnRowClick: true,
					keepContentWhenOpen: true,
					onToggle: () => {
						setExpanded((value) => !value);
					},
					collapsedContent: (0, react_jsx_runtime.jsxs)("span", {
						className: PresentRow_module_css_default.summary,
						children: [(0, react_jsx_runtime.jsx)("span", { children: t(`row.${state}`) }), (0, react_jsx_runtime.jsx)("span", {
							className: PresentRow_module_css_default.paths,
							children: fileNames(args)
						})]
					}),
					children: [(0, react_jsx_runtime.jsx)("pre", {
						className: PresentRow_module_css_default.output,
						children: details
					}), inspect && (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PresentRow_module_css_default.inspect,
						onClick: inspect,
						children: t("row.inspect")
					})]
				})
			});
		}
		//#endregion
		//#region ../../util/workspace-path/lib/index.js
		/**
		* The `dsh-resource://file/…` address grammar: how a file is named across the
		* Sidebar and the resource model, built and parsed without touching a
		* filesystem.
		* @module
		*/
		/** The scheme and type every file address opens with. */
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
		function encodeSegment(segment) {
			return encodeURIComponent(segment).replace(/%3A/gi, ":");
		}
		/** Encode a `/`-separated path segment by segment. */
		function encodePath(path) {
			return path.split("/").map(encodeSegment).join("/");
		}
		/**
		* Build the address of a file read through one Session.
		* @param sessionId - the Session whose Host workspace resolves the path.
		* @param path - absolute or workspace-relative path; backslashes are normalized to `/`, and leading `./` prefixes are dropped.
		* @returns the `dsh-resource://file/session/<sessionId>/<path>` address.
		*/
		function sessionFileAddress(sessionId, path) {
			const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
		}
		/**
		* Browser-safe Workspace path and display helpers.
		* @module @deepseek-ai/dsh-util-workspace-path
		*/
		/** Whether a path uses a Windows drive or UNC prefix. */
		function isWindowsStylePath(value) {
			return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
		}
		/**
		* Whether a path is absolute in either spelling the Host accepts: POSIX (`/a/b`) or Windows drive or UNC.
		* @param path - the path to classify.
		* @returns `true` for an absolute path; `false` for a Workspace-relative one.
		*/
		function isAbsoluteWorkspacePath(path) {
			return path.startsWith("/") || isWindowsStylePath(path);
		}
		/**
		* Resolve a Workspace-relative path into the Host-facing spelling used by path operations.
		* @param cwd - Session Workspace root, when known.
		* @param path - Absolute or Workspace-relative path.
		* @returns an absolute path when a Workspace root is available, otherwise the original path.
		*/
		function resolveWorkspacePath(cwd, path) {
			if (isAbsoluteWorkspacePath(path)) return path;
			if (cwd === void 0 || cwd === "") return path;
			const separator = isWindowsStylePath(cwd) && cwd.includes("\\") ? "\\" : "/";
			return `${cwd.replace(/[/\\]+$/, "")}${separator}${path.replace(/^[/\\]+/, "")}`;
		}
		/**
		* The address for a path as a caller holds it: a relative path, or an absolute
		* path inside the Session's workspace, becomes a `session`-scoped address; an
		* absolute path outside it, or one whose workspace root is unknown, keeps its
		* absolute path in that Session's address.
		* @param sessionId - the Session the path is read in.
		* @param cwd - that Session's workspace root, when known.
		* @param path - absolute or workspace-relative path, in either separator spelling.
		* @returns the `dsh-resource://file/…` address.
		*/
		function fileAddressFor(sessionId, cwd, path) {
			const normalized = path.replace(/\\/g, "/");
			if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
			const root = cwd === void 0 ? "" : cwd.replace(/\\/g, "/").replace(/\/+$/, "");
			if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
			if (root !== "" && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
			return sessionFileAddress(sessionId, normalized);
		}
		//#endregion
		//#region \0dsh-css:D:\deepseek-harness\packages\client\ui-deliverables\src\client\FileDiff.module.css.mjs
		const css$3 = ".sAcvqq_root{--diff-empty-fill:color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 50%, transparent);box-sizing:border-box;width:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}.sAcvqq_header{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:6px;height:38px;padding:0 6px 0 8px;display:flex}.sAcvqq_status{color:var(--dsw-alias-label-secondary);align-items:center;gap:12px;margin:0;padding:16px;font-size:13px;display:flex}.sAcvqq_body{min-height:0;font:var(--dsw-font-markdown-code-block);flex-direction:column;flex:auto;padding:8px 0 16px;display:flex;overflow:auto}.sAcvqq_columns{flex:auto;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:0;display:grid}.sAcvqq_column,.sAcvqq_body[data-review-view=unified]:not([data-review-wrap]){grid-template-columns:minmax(max-content,100%);align-content:start;display:grid}.sAcvqq_column{overscroll-behavior:none;min-width:0;overflow-x:scroll}.sAcvqq_column+.sAcvqq_column{border-left:.5px solid var(--dsw-alias-border-l3)}.sAcvqq_sideLine{box-sizing:border-box;white-space:pre;grid-template-columns:3.5em max-content;width:max-content;min-width:100%;min-height:22px;line-height:22px;display:grid}.sAcvqq_note{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:0;padding:4px 16px 8px}.sAcvqq_hunk{margin-bottom:8px}.sAcvqq_hunkHeader{color:var(--dsw-alias-label-tertiary);white-space:pre;padding:4px 16px}.sAcvqq_line{box-sizing:border-box;white-space:pre;grid-template-columns:3.5em 3.5em 1.2em minmax(0,1fr);min-height:22px;line-height:22px;display:grid}.sAcvqq_splitLine{white-space:pre;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:22px;line-height:22px;display:grid}.sAcvqq_cell{box-sizing:border-box;grid-template-columns:3.5em minmax(0,1fr);min-width:0;display:grid}.sAcvqq_cell+.sAcvqq_cell{border-left:.5px solid var(--dsw-alias-border-l3)}.sAcvqq_number{color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none;padding-right:8px}.sAcvqq_sign{text-align:center;user-select:none}.sAcvqq_text{padding-right:16px}.sAcvqq_body[data-review-wrap] .sAcvqq_line,.sAcvqq_body[data-review-wrap] .sAcvqq_splitLine{white-space:pre-wrap}.sAcvqq_body[data-review-wrap] .sAcvqq_text{overflow-wrap:anywhere}.sAcvqq_add{--diff-gutter-fill:var(--dsw-alias-file-diff-added-gutter);--diff-marker:var(--dsw-alias-file-diff-added-marker);background:var(--dsw-alias-file-diff-added-bg)}.sAcvqq_del{--diff-gutter-fill:var(--dsw-alias-file-diff-deleted-gutter);--diff-marker:var(--dsw-alias-file-diff-deleted-marker);background:var(--dsw-alias-file-diff-deleted-bg)}.sAcvqq_add .sAcvqq_number,.sAcvqq_del .sAcvqq_number{background:var(--diff-gutter-fill);color:var(--diff-marker)}.sAcvqq_add .sAcvqq_number:first-child,.sAcvqq_del .sAcvqq_number:first-child{box-shadow:inset 3px 0 0 var(--diff-marker)}.sAcvqq_add .sAcvqq_sign,.sAcvqq_del .sAcvqq_sign{color:var(--diff-marker)}.sAcvqq_context .sAcvqq_text{color:var(--dsw-alias-label-secondary)}.sAcvqq_empty{background:var(--diff-empty-fill)}";
		const tagId$3 = "@deepseek-ai/dsh-client-ui-deliverables/FileDiff.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-deliverables";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var FileDiff_module_css_default = {
			"add": "sAcvqq_add",
			"body": "sAcvqq_body",
			"cell": "sAcvqq_cell",
			"column": "sAcvqq_column",
			"columns": "sAcvqq_columns",
			"context": "sAcvqq_context",
			"del": "sAcvqq_del",
			"empty": "sAcvqq_empty",
			"header": "sAcvqq_header",
			"hunk": "sAcvqq_hunk",
			"hunkHeader": "sAcvqq_hunkHeader",
			"line": "sAcvqq_line",
			"note": "sAcvqq_note",
			"number": "sAcvqq_number",
			"root": "sAcvqq_root",
			"sideLine": "sAcvqq_sideLine",
			"sign": "sAcvqq_sign",
			"splitLine": "sAcvqq_splitLine",
			"status": "sAcvqq_status",
			"text": "sAcvqq_text"
		};
		//#endregion
		//#region lib/types/client/FileDiff.js
		/** Shared file comparison for the turn-tail hover preview and Sidebar review. */
		/** Maximum rendered lines per comparison. */
		const MAX_RENDERED_LINES = 5e3;
		function highlightedSide(rows, side, highlighter) {
			const source = rows.flatMap((row) => {
				const no = row[side];
				return no === void 0 ? [] : [{
					no,
					text: row.text
				}];
			});
			if (source.length === 0) return /* @__PURE__ */ new Map();
			const highlighted = highlighter(source.map((line) => line.text).join("\n"));
			if (highlighted === void 0) return void 0;
			return new Map(source.map((line, index) => {
				return [line.no, highlighted[index] ?? []];
			}));
		}
		function hunkHighlights(hunk, highlighter) {
			const rows = hunkRows(hunk);
			return {
				old: highlightedSide(rows, "old", highlighter),
				new: highlightedSide(rows, "new", highlighter)
			};
		}
		function DiffText({ text, spans }) {
			return (0, react_jsx_runtime.jsx)("span", {
				className: FileDiff_module_css_default.text,
				"data-diff-code": spans === void 0 ? void 0 : "",
				children: spans === void 0 ? text : spans.map((span, index) => (0, react_jsx_runtime.jsx)("span", {
					style: span.style,
					children: span.text
				}, index))
			});
		}
		/**
		* Number a hunk's lines: context lines count on both sides, deletions on the
		* old side, additions on the new side.
		* @param hunk - a served hunk.
		* @returns the rows in order.
		*/
		function hunkRows(hunk) {
			let oldNo = hunk.oldStart;
			let newNo = hunk.newStart;
			return hunk.lines.map((line) => {
				const text = line.slice(1);
				switch (line[0]) {
					case "+": return {
						kind: "add",
						old: void 0,
						new: newNo++,
						text
					};
					case "-": return {
						kind: "del",
						old: oldNo++,
						new: void 0,
						text
					};
					default: return {
						kind: "context",
						old: oldNo++,
						new: newNo++,
						text
					};
				}
			});
		}
		/**
		* Pair a hunk's lines for the side-by-side view: each run of deletions is
		* aligned with the run of additions that follows it, row by row, and context
		* lines sit on both sides.
		* @param hunk - a served hunk.
		* @returns the rows in order.
		*/
		function splitRows(hunk) {
			const rows = [];
			let dels = [];
			let adds = [];
			const flush = () => {
				for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
					const left = dels[at];
					const right = adds[at];
					rows.push({
						...left === void 0 ? {} : { left },
						...right === void 0 ? {} : { right }
					});
				}
				dels = [];
				adds = [];
			};
			for (const row of hunkRows(hunk)) if (row.kind === "del") dels.push({
				no: row.old,
				text: row.text,
				kind: "del"
			});
			else if (row.kind === "add") adds.push({
				no: row.new,
				text: row.text,
				kind: "add"
			});
			else {
				flush();
				rows.push({
					left: {
						no: row.old,
						text: row.text,
						kind: "context"
					},
					right: {
						no: row.new,
						text: row.text,
						kind: "context"
					}
				});
			}
			flush();
			return rows;
		}
		/**
		* The hunks to draw, cut at {@link MAX_RENDERED_LINES} lines in total.
		* @param hunks - served hunks.
		* @returns the hunks with the last one shortened as needed, and whether anything was cut.
		*/
		function renderedHunks(hunks) {
			let budget = MAX_RENDERED_LINES;
			const kept = [];
			for (const hunk of hunks) {
				if (budget === 0) return {
					hunks: kept,
					truncated: true
				};
				kept.push(hunk.lines.length <= budget ? hunk : {
					...hunk,
					lines: hunk.lines.slice(0, budget)
				});
				budget -= Math.min(budget, hunk.lines.length);
			}
			return {
				hunks: kept,
				truncated: hunks.some((hunk, at) => kept[at] !== hunk)
			};
		}
		/** The one-line fact about a text comparison worth stating above its hunks, if any. */
		function noteOf(diff) {
			if (!diff.before) return "diff.created";
			if (!diff.after) return "diff.deleted";
			if (diff.hunks.length === 0) return "diff.unchanged";
		}
		/**
		* Render a file comparison with the same states and highlighting in previews and review tabs.
		* Addition-only and deletion-only comparisons use one column without changing the requested layout.
		* @param props - comparison state, layout choices, retry action, and localized copy.
		* @returns the comparison or its loading, unavailable, or error state.
		*/
		function FileDiff({ state, split, wrap, retry, t }) {
			if (state === void 0 || state === "loading") return (0, react_jsx_runtime.jsx)("p", {
				className: FileDiff_module_css_default.status,
				role: "status",
				children: t("diff.loading")
			});
			if (state === "missing") return (0, react_jsx_runtime.jsx)("p", {
				className: FileDiff_module_css_default.status,
				children: t("diff.missing")
			});
			if (state === "error") return (0, react_jsx_runtime.jsxs)("div", {
				className: FileDiff_module_css_default.status,
				children: [(0, react_jsx_runtime.jsx)("span", { children: t("diff.error") }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					onClick: retry,
					children: t("presented.retry")
				})]
			});
			if (state.kind === "binary") return (0, react_jsx_runtime.jsx)("p", {
				className: FileDiff_module_css_default.status,
				children: t("diff.binary")
			});
			if (state.kind === "oversized") return (0, react_jsx_runtime.jsx)("p", {
				className: FileDiff_module_css_default.status,
				children: t("diff.oversized")
			});
			const oneSided = state.hunks.some((hunk) => hunk.lines.some((line) => line.startsWith("+"))) !== state.hunks.some((hunk) => hunk.lines.some((line) => line.startsWith("-")));
			return (0, react_jsx_runtime.jsx)(TextDiff, {
				diff: state,
				split: split && !oneSided,
				wrap,
				t
			});
		}
		/** The kind a paired row carries: a deletion or addition on either side, otherwise context. */
		function splitRowKind(row) {
			return row.left?.kind === "del" ? "del" : row.right?.kind === "add" ? "add" : "context";
		}
		function hunkHeader(hunk) {
			return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
		}
		/**
		* The side-by-side view without wrapping: two columns that clip their long
		* lines and scroll together on both axes, so a long line on one side never
		* runs under the other and both sides show the same rows and columns of text.
		* Every line is one fixed-height row, which keeps the sides aligned.
		* The columns suppress elastic overscroll while retaining native in-range scrolling.
		*/
		function SplitColumns({ hunks, highlights }) {
			const paired = (0, react.useMemo)(() => hunks.map((hunk) => ({
				header: hunkHeader(hunk),
				rows: splitRows(hunk)
			})), [hunks]);
			const columns = (0, react.useRef)({
				left: null,
				right: null
			});
			const offsets = (0, react.useRef)({
				left: {
					scrollLeft: 0,
					scrollTop: 0
				},
				right: {
					scrollLeft: 0,
					scrollTop: 0
				}
			});
			const follow = (side) => (event) => {
				const peer = side === "left" ? "right" : "left";
				const other = columns.current[peer];
				/* v8 ignore next -- Both column refs are attached before browser scroll events can run. */
				if (other === null) return;
				for (const axis of ["scrollLeft", "scrollTop"]) {
					const value = event.currentTarget[axis];
					if (offsets.current[side][axis] === value) continue;
					offsets.current[side][axis] = value;
					other[axis] = value;
					offsets.current[peer][axis] = other[axis];
				}
			};
			return (0, react_jsx_runtime.jsx)("div", {
				className: FileDiff_module_css_default.columns,
				children: ["left", "right"].map((side) => (0, react_jsx_runtime.jsx)("div", {
					className: FileDiff_module_css_default.column,
					"data-diff-side": side,
					ref: (element) => {
						columns.current[side] = element;
					},
					onScroll: follow(side),
					children: paired.map((hunk, position) => (0, react_jsx_runtime.jsxs)("section", {
						className: FileDiff_module_css_default.hunk,
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: FileDiff_module_css_default.hunkHeader,
							"data-diff-hunk-header": true,
							children: hunk.header
						}), hunk.rows.map((row, at) => {
							const cell = row[side];
							const spans = cell === void 0 ? void 0 : highlights[position]?.[side === "left" ? "old" : "new"]?.get(cell.no);
							return (0, react_jsx_runtime.jsxs)("div", {
								className: `${FileDiff_module_css_default.sideLine} ${cell === void 0 ? FileDiff_module_css_default.empty : FileDiff_module_css_default[cell.kind]}`,
								"data-diff-line": splitRowKind(row),
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: FileDiff_module_css_default.number,
									children: cell?.no ?? ""
								}), (0, react_jsx_runtime.jsx)(DiffText, {
									text: cell?.text ?? "",
									spans
								})]
							}, at);
						})]
					}, position))
				}, side))
			});
		}
		/** The hunks of a text comparison with their line numbers, unified or side by side. */
		function TextDiff({ diff, split, wrap, t }) {
			const note = noteOf(diff);
			const { hunks, truncated } = (0, react.useMemo)(() => renderedHunks(diff.hunks), [diff.hunks]);
			const highlighter = (0, _deepseek_ai_dsh_client_ui_primitives.useCodeHighlighter)((0, _deepseek_ai_dsh_client_ui_primitives.languageForPath)(diff.path));
			const highlights = (0, react.useMemo)(() => hunks.map((hunk) => hunkHighlights(hunk, highlighter)), [hunks, highlighter]);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: FileDiff_module_css_default.body,
				"data-review-view": split ? "split" : "unified",
				"data-review-wrap": wrap || void 0,
				children: [
					note !== void 0 && (0, react_jsx_runtime.jsx)("p", {
						className: FileDiff_module_css_default.note,
						"data-diff-note": hunks.length === 0 ? "empty" : "metadata",
						children: t(note)
					}),
					diff.coarse && (0, react_jsx_runtime.jsx)("p", {
						className: FileDiff_module_css_default.note,
						"data-diff-coarse": true,
						children: t("diff.coarse")
					}),
					truncated && (0, react_jsx_runtime.jsx)("p", {
						className: FileDiff_module_css_default.note,
						"data-diff-truncated": true,
						children: t("diff.truncated", { count: String(5e3) })
					}),
					split && !wrap ? (0, react_jsx_runtime.jsx)(SplitColumns, {
						hunks,
						highlights
					}) : hunks.map((hunk, position) => {
						const highlighted = highlights[position];
						return (0, react_jsx_runtime.jsxs)("section", {
							className: FileDiff_module_css_default.hunk,
							children: [(0, react_jsx_runtime.jsx)("div", {
								className: FileDiff_module_css_default.hunkHeader,
								"data-diff-hunk-header": true,
								children: hunkHeader(hunk)
							}), split ? splitRows(hunk).map((row, at) => (0, react_jsx_runtime.jsxs)("div", {
								className: FileDiff_module_css_default.splitLine,
								"data-diff-line": splitRowKind(row),
								children: [(0, react_jsx_runtime.jsxs)("span", {
									className: `${FileDiff_module_css_default.cell} ${row.left === void 0 ? FileDiff_module_css_default.empty : FileDiff_module_css_default[row.left.kind]}`,
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: FileDiff_module_css_default.number,
										children: row.left?.no ?? ""
									}), (0, react_jsx_runtime.jsx)(DiffText, {
										text: row.left?.text ?? "",
										spans: row.left === void 0 ? void 0 : highlighted?.old?.get(row.left.no)
									})]
								}), (0, react_jsx_runtime.jsxs)("span", {
									className: `${FileDiff_module_css_default.cell} ${row.right === void 0 ? FileDiff_module_css_default.empty : FileDiff_module_css_default[row.right.kind]}`,
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: FileDiff_module_css_default.number,
										children: row.right?.no ?? ""
									}), (0, react_jsx_runtime.jsx)(DiffText, {
										text: row.right?.text ?? "",
										spans: row.right === void 0 ? void 0 : highlighted?.new?.get(row.right.no)
									})]
								})]
							}, at)) : hunkRows(hunk).map((row, at) => (0, react_jsx_runtime.jsxs)("div", {
								className: `${FileDiff_module_css_default.line} ${FileDiff_module_css_default[row.kind]}`,
								"data-diff-line": row.kind,
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										className: FileDiff_module_css_default.number,
										children: row.old ?? ""
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: FileDiff_module_css_default.number,
										children: row.new ?? ""
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: FileDiff_module_css_default.sign,
										children: row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "
									}),
									(0, react_jsx_runtime.jsx)(DiffText, {
										text: row.text,
										spans: row.kind === "add" ? highlighted?.new?.get(row.new) : highlighted?.old?.get(row.old)
									})
								]
							}, at))]
						}, position);
					})
				]
			});
		}
		//#endregion
		//#region ../../core/session/lib/types/surface.js
		/** Runtime counterpart of the message-producing event union. */
		const SURFACE_EVENT_TYPES = new Set([
			"system/message",
			"developer/message",
			"user/message",
			"assistant/message",
			"tool/result"
		]);
		/**
		* Narrow an event to a surface-eligible event carrying its required marker.
		* @param event - event to test.
		* @returns true when both the type and marker identify a surface event.
		*/
		function isSurfaceEvent(event) {
			if (!SURFACE_EVENT_TYPES.has(event.type)) return false;
			return event.surfaceOp !== void 0;
		}
		/**
		* Narrow an event to an append-origin surface event: one that entered the
		* surface at its own log position and was never itself a replacement copy.
		*
		* The model-visible surface deliberately shadows replaced ranges, so it is the
		* wrong source for a human transcript — a landed replacement would erase
		* conversation the user already saw. Append-origin events are that transcript's
		* durable source material; replacement copies stay model-only.
		* @param event - event to test.
		* @returns true when the event appended to the surface tail.
		*/
		function isAppendSurfaceEvent(event) {
			return isSurfaceEvent(event) && event.surfaceOp === "append";
		}
		//#endregion
		//#region lib/types/client/turn-deliverables.js
		/**
		* Turn-scoped produced-file Definition and readers. Client-only and
		* model-free: produced paths come from successful first-party mutation calls,
		* changed files from the Host's recorded git summary, and deliveries from
		* `present`; never from presentation data or the closing prose.
		*/
		/**
		* Extract the path from a supported first-party mutation call. Session
		* `tool/call` events are root calls; PTC dispatch children do not enter this
		* Definition independently.
		* @param name - wire tool name.
		* @param argsRaw - model-produced JSON arguments.
		* @returns the mutation path, or null when the call is not a supported mutation.
		*/
		function mutationPath(name, argsRaw) {
			let args;
			try {
				args = JSON.parse(argsRaw);
			} catch {
				return null;
			}
			if (!isRecord(args)) return null;
			switch (name) {
				case "write": return typeof args.content === "string" ? pathValue(args.file_path) : null;
				case "edit": return validEditArgs(args) ? pathValue(args.file_path) : null;
				case "str_replace_editor": return editorMutationPath(args);
				default: return null;
			}
		}
		/** Validate the fields that an `edit` execution requires. */
		function validEditArgs(args) {
			return typeof args.old_string === "string" && args.old_string.length > 0 && typeof args.new_string === "string" && args.old_string !== args.new_string && (args.replace_all === void 0 || typeof args.replace_all === "boolean");
		}
		/** Extract a path only from a complete mutating editor command. */
		function editorMutationPath(args) {
			const path = pathValue(args.path);
			if (path === null) return null;
			switch (args.command) {
				case "create": return typeof args.file_text === "string" ? path : null;
				case "str_replace": return typeof args.old_str === "string" && args.old_str.length > 0 && (args.new_str === void 0 || typeof args.new_str === "string") ? path : null;
				case "insert": return typeof args.insert_line === "number" && Number.isInteger(args.insert_line) && args.insert_line >= 0 && typeof args.new_str === "string" ? path : null;
				default: return null;
			}
		}
		/** A non-blank path preserves the exact spelling supplied to the tool. */
		function pathValue(value) {
			return typeof value === "string" && value.trim().length > 0 ? value : null;
		}
		/** Narrow parsed JSON to an argument object. */
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/**
		* Files produced by one Turn data value.
		*
		* The source is the arguments of successful `write`, `edit`, and mutating
		* `str_replace_editor` calls, not the closing prose: a produced file must be
		* listed whether or not the model remembered to name it. Reads, unsupported
		* tools, malformed calls, and failed results contribute nothing. Paths keep
		* first-seen order and appear once, so a file written and then edited in the
		* same turn is one entry.
		*
		* The Conversation Location index owns turn membership before this function
		* runs, so paths cannot spill across turns and this derivation does not infer
		* boundaries from neighboring presentation Nodes.
		* @param data - engine-published Deliverables data for one Turn.
		* @param seq - closing Assistant seq; later Tool settlements are excluded.
		* @returns Produced paths in first-seen order; empty when the turn wrote nothing.
		*/
		function producedForClosing(data, seq = Number.POSITIVE_INFINITY) {
			if (data === void 0) return [];
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (const produced of data.produced) {
				if (produced.seq > seq || seen.has(produced.path)) continue;
				seen.add(produced.path);
				paths.push(produced.path);
			}
			return paths;
		}
		/**
		* Claim the turn-tail chain only when its closing turn produced files.
		* @param owner - Turn-tail owner currency for the closing assistant.
		* @returns Produced paths as the component's match, or null to decline before mount.
		*/
		function selectProducedFiles(owner) {
			const paths = producedForClosing(owner.turn.data.get("deliverables"), owner.seq);
			return paths.length === 0 ? null : paths;
		}
		/** Turn-local successful mutation accumulator; it publishes no view Node. */
		const deliverablesDefinition = {
			kind: "deliverables",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "tool/call") return {
					id: String(event.data.turn),
					role: "update"
				};
				if (event.type === "deliverables/presented") return isPresentedData(event.data) ? {
					id: String(event.data.turn),
					role: "update"
				} : null;
				if (event.type === "workspace/changes") return isChangesEvent(event.data) ? {
					id: String(event.data.turn),
					role: "update"
				} : null;
				if (event.type === "tool/result" && isAppendSurfaceEvent(event)) return {
					id: String(event.data.turn),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("deliverables start requires turn/start");
				return {
					turn: match.event.data.turn,
					calls: /* @__PURE__ */ new Map(),
					produced: []
				};
			},
			update: (context, match) => {
				if (match.event.type === "workspace/changes") return {
					...context.state,
					changes: { seq: match.event.seq }
				};
				if (match.event.type === "deliverables/presented") {
					const { files } = match.event.data;
					const seq = match.event.seq;
					const presented = [];
					for (let index = 0; index < files.length; index += 1) {
						const file = files[index];
						if (isPresentedFile(file)) presented.push({
							...file,
							seq,
							index
						});
					}
					if (presented.length === 0) return context.state;
					return {
						...context.state,
						presented: [...context.state.presented ?? [], ...presented]
					};
				}
				if (match.event.type === "tool/call") {
					const calls = new Map(context.state.calls);
					calls.set(String(match.event.data.callId), mutationPath(match.event.data.name, match.event.data.arguments));
					return {
						...context.state,
						calls
					};
				}
				if (match.event.type !== "tool/result") return context.state;
				if (match.event.data.message.isError === true) return context.state;
				const callId = String(match.event.data.message.source.callId);
				const path = context.state.calls.get(callId);
				return path === null || path === void 0 ? context.state : {
					...context.state,
					produced: [...context.state.produced, {
						seq: match.event.seq,
						path
					}]
				};
			},
			buildLocationData: (context, scope, previous) => {
				if (scope !== "turn" || context.state === void 0) return null;
				if (previous?.kind === "turn" && previous.turn === context.state.turn && previous.key === "deliverables" && previous.value.produced === context.state.produced && previous.value.presented === context.state.presented && previous.value.changes === context.state.changes) return previous;
				return {
					kind: "turn",
					turn: context.state.turn,
					key: "deliverables",
					value: {
						produced: context.state.produced,
						...context.state.presented === void 0 ? {} : { presented: context.state.presented },
						...context.state.changes === void 0 ? {} : { changes: context.state.changes }
					}
				};
			}
		};
		/**
		* The turn's latest change announcement.
		* @param owner - closing turn.
		* @returns the announcement, or null when the Host recorded none.
		*/
		function changesForClosing(owner) {
			return owner.turn.data.get("deliverables")?.changes ?? null;
		}
		/**
		* Select the latest declaration of each path before the closing reply.
		* @param owner - closing turn and sequence.
		* @returns replayable deliveries in first-seen path order.
		*/
		function presentedForClosing(owner) {
			const files = /* @__PURE__ */ new Map();
			for (const file of owner.turn.data.get("deliverables")?.presented ?? []) if (file.seq < owner.seq) files.set(file.path, file);
			return [...files.values()];
		}
		/**
		* Resolves inline-code references against one turn's produced or delivered
		* paths. Exact paths resolve directly; a basename resolves only when exactly
		* one supplied path has that basename. Ambiguous and unknown tokens stay inert.
		* @param paths - The turn's produced or delivered paths, already deduplicated.
		* @param openFile - The chat view's file opener.
		* @param label - Localizes the accessible open-label for a resolved path.
		* @returns The resolver MarkdownText consumes; the full path rides `title`,
		* the same disambiguator the row's chips carry.
		*/
		function producedFileMentions(paths, openFile, label) {
			return { resolve(value) {
				const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value);
				if (path === void 0) return void 0;
				return {
					open: () => {
						openFile(path);
					},
					label: label(path),
					title: path
				};
			} };
		}
		/** The single supplied path whose basename is exactly `value`, else undefined. */
		function onlyPathWithBasename(paths, value) {
			const matches = paths.filter((path) => basename(path) === value);
			return matches.length === 1 ? matches[0] : void 0;
		}
		//#endregion
		//#region \0dsh-css:D:\deepseek-harness\packages\client\ui-deliverables\src\client\ChangedFiles.module.css.mjs
		const css$2 = ".aaWu5W_card{--changes-fill:var(--dsw-static-neutral-50);--changes-hover:var(--dsw-static-neutral-100);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);min-width:0;color:var(--dsw-alias-label-primary);flex-direction:column;margin-top:4px;display:flex;overflow:hidden}.aaWu5W_card[data-single=true]{border-color:var(--dsw-alias-border-l1)}body[data-ds-dark-theme] .aaWu5W_card{--changes-fill:var(--dsw-static-neutral-850);--changes-hover:var(--dsw-static-neutral-800)}.aaWu5W_header{box-sizing:border-box;background:var(--changes-fill);width:100%;min-width:0;height:60px;color:inherit;font:inherit;text-align:left;border:0;align-items:center;gap:10px;margin:0;padding:8px 10px;display:flex}button.aaWu5W_header{cursor:pointer;transition:background-color .12s}button.aaWu5W_header:hover:not(:disabled),button.aaWu5W_header:focus-visible{background:var(--changes-hover)}button.aaWu5W_header:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none}button.aaWu5W_header:disabled{cursor:progress}.aaWu5W_tile{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1);background:color-mix(in srgb, var(--dsw-static-neutral-00) 50%, transparent);border-radius:10px;flex:none;place-items:center;width:40px;height:40px;display:grid}body[data-ds-dark-theme] .aaWu5W_tile{background:color-mix(in srgb, var(--dsw-static-neutral-00) 5%, transparent)}.aaWu5W_titles{flex-direction:column;flex:1;min-width:0;display:flex}.aaWu5W_title{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}.aaWu5W_stat{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;display:inline-flex}.aaWu5W_statCounts{font-family:var(--ds-font-family-code);gap:6px;display:inline-flex}.aaWu5W_previewHint,.aaWu5W_header:hover .aaWu5W_statCounts,.aaWu5W_header:focus-visible .aaWu5W_statCounts{display:none}.aaWu5W_header:hover .aaWu5W_previewHint,.aaWu5W_header:focus-visible .aaWu5W_previewHint{display:inline}.aaWu5W_stat[data-error=true],.aaWu5W_counts[data-error=true]{color:var(--dsw-alias-state-error-primary)}.aaWu5W_added{color:var(--dsw-alias-state-success-primary)}.aaWu5W_deleted{color:var(--dsw-alias-state-error-primary)}.aaWu5W_list{border-top:.5px solid var(--dsw-alias-border-l2);margin:0;padding:0;list-style:none}.aaWu5W_row{box-sizing:border-box;width:100%;min-width:0;min-height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-family:var(--ds-font-family-code);text-align:left;background:0 0;border:0;justify-content:space-between;align-items:center;gap:10px;margin:0;padding:7px 18px 7px 14px;font-size:11px;line-height:18px;display:flex}.aaWu5W_row:hover:not(:disabled),.aaWu5W_row:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.aaWu5W_row:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none}.aaWu5W_row:disabled{cursor:progress}.aaWu5W_path{min-width:0;font-family:var(--dsw-font-family);text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.aaWu5W_counts{white-space:nowrap;color:var(--dsw-alias-label-tertiary);flex:none;gap:6px;display:inline-flex}.aaWu5W_toggle{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;justify-content:flex-start;align-items:center;gap:4px;margin:0;padding:10px 18px 10px 14px;font-size:12px;line-height:18px;display:inline-flex}.aaWu5W_toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.aaWu5W_toggle svg{flex:none;width:14px;height:14px}@media (pointer:coarse){.aaWu5W_row,.aaWu5W_toggle{min-height:44px}}.aaWu5W_preview{max-height:100%;overflow:hidden}.aaWu5W_previewPath{min-width:0;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);white-space:nowrap;flex:auto;font-size:12px;line-height:20px;overflow:auto hidden}.aaWu5W_preview [data-diff-note=metadata],.aaWu5W_preview [data-diff-hunk-header]{display:none}";
		const tagId$2 = "@deepseek-ai/dsh-client-ui-deliverables/ChangedFiles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-deliverables";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var ChangedFiles_module_css_default = {
			"added": "aaWu5W_added",
			"card": "aaWu5W_card",
			"counts": "aaWu5W_counts",
			"deleted": "aaWu5W_deleted",
			"header": "aaWu5W_header",
			"list": "aaWu5W_list",
			"path": "aaWu5W_path",
			"preview": "aaWu5W_preview",
			"previewHint": "aaWu5W_previewHint",
			"previewPath": "aaWu5W_previewPath",
			"row": "aaWu5W_row",
			"stat": "aaWu5W_stat",
			"statCounts": "aaWu5W_statCounts",
			"tile": "aaWu5W_tile",
			"title": "aaWu5W_title",
			"titles": "aaWu5W_titles",
			"toggle": "aaWu5W_toggle"
		};
		//#endregion
		//#region lib/types/client/ChangedFiles.js
		/** Turn changes use a compact single-file card or a header with a folded file list. */
		/** Rows shown before the fold; the design's summary height for a closing message. */
		const COLLAPSED_ROWS = 4;
		const GROUPED$1 = new Intl.NumberFormat("en-US");
		/** Added and deleted line counts in the card's colors. */
		function Counts$1({ added, deleted, t }) {
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
				className: ChangedFiles_module_css_default.added,
				children: t("changes.added", { count: GROUPED$1.format(added) })
			}), (0, react_jsx_runtime.jsx)("span", {
				className: ChangedFiles_module_css_default.deleted,
				children: t("changes.deleted", { count: GROUPED$1.format(deleted) })
			})] });
		}
		/**
		* Render one turn's changed files. The header opens the turn's review in the
		* right Sidebar on its first file. A single file uses only the header; it and
		* multi-file rows preview their comparison after a 500ms hover.
		* @param props - the recorded summary, the review opener, and localized copy.
		* @returns the card.
		*/
		function ChangedFiles({ changes, cwd, openReview, t, sessionId, useChangesDiff, loadChangesDiff }) {
			const cardRef = (0, react.useRef)(null);
			const pathDescriptionId = (0, react.useId)();
			const [expanded, setExpanded] = (0, react.useState)(false);
			const singleFile = changes.total === 1 ? changes.files[0] : void 0;
			const foldable = changes.files.length > COLLAPSED_ROWS;
			const rows = foldable && !expanded ? changes.files.slice(0, COLLAPSED_ROWS) : changes.files;
			const header = (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ChangedFiles_module_css_default.header,
				"aria-label": singleFile === void 0 ? t("changes.openReview") : t("changes.viewDiff", { name: singleFile.display }),
				"aria-describedby": singleFile === void 0 ? void 0 : pathDescriptionId,
				onClick: () => {
					openReview(0);
				},
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: ChangedFiles_module_css_default.tile,
					children: singleFile === void 0 ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
						kind: "code",
						size: 20
					}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
						path: singleFile.path,
						size: 20
					})
				}), (0, react_jsx_runtime.jsxs)("span", {
					className: ChangedFiles_module_css_default.titles,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: ChangedFiles_module_css_default.title,
						children: singleFile === void 0 ? t("changes.title", { count: String(changes.total) }) : t("changes.singleTitle", { name: basename(singleFile.path) })
					}), (0, react_jsx_runtime.jsxs)("span", {
						className: ChangedFiles_module_css_default.stat,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ChangedFiles_module_css_default.statCounts,
							children: singleFile?.binary === true ? t("changes.binary") : singleFile?.oversized === true ? t("changes.oversized") : (0, react_jsx_runtime.jsx)(Counts$1, {
								t,
								added: changes.added,
								deleted: changes.deleted
							})
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ChangedFiles_module_css_default.previewHint,
							children: t("presented.preview")
						})]
					})]
				})]
			});
			return (0, react_jsx_runtime.jsxs)("div", {
				ref: cardRef,
				className: ChangedFiles_module_css_default.card,
				"data-changed-files": true,
				"data-single": singleFile !== void 0 || void 0,
				children: [
					singleFile === void 0 ? header : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
						variant: "preview",
						widthAnchorRef: cardRef,
						openDelayMs: 500,
						anchor: header,
						content: (0, react_jsx_runtime.jsx)(ChangedFilePreview, {
							sessionId,
							seq: changes.seq,
							index: 0,
							display: resolveWorkspacePath(cwd, singleFile.path),
							useChangesDiff,
							loadChangesDiff,
							t
						})
					}), (0, react_jsx_runtime.jsx)("span", {
						id: pathDescriptionId,
						hidden: true,
						children: resolveWorkspacePath(cwd, singleFile.path)
					})] }),
					singleFile === void 0 && (0, react_jsx_runtime.jsx)("ul", {
						className: ChangedFiles_module_css_default.list,
						children: rows.map((file, index) => (0, react_jsx_runtime.jsxs)("li", { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
							variant: "preview",
							widthAnchorRef: cardRef,
							openDelayMs: 500,
							content: (0, react_jsx_runtime.jsx)(ChangedFilePreview, {
								sessionId,
								seq: changes.seq,
								index,
								display: resolveWorkspacePath(cwd, file.path),
								useChangesDiff,
								loadChangesDiff,
								t
							}),
							anchor: (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ChangedFiles_module_css_default.row,
								"aria-label": t("changes.viewDiff", { name: file.display }),
								"aria-describedby": `${pathDescriptionId}-${index}`,
								onClick: () => {
									openReview(index);
								},
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ChangedFiles_module_css_default.path,
									children: file.display
								}), (0, react_jsx_runtime.jsx)("span", {
									className: ChangedFiles_module_css_default.counts,
									children: file.binary === true ? t("changes.binary") : file.oversized === true ? t("changes.oversized") : (0, react_jsx_runtime.jsx)(Counts$1, {
										t,
										added: file.added,
										deleted: file.deleted
									})
								})]
							})
						}), (0, react_jsx_runtime.jsx)("span", {
							id: `${pathDescriptionId}-${index}`,
							hidden: true,
							children: resolveWorkspacePath(cwd, file.path)
						})] }, file.display))
					}),
					foldable && (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ChangedFiles_module_css_default.toggle,
						"aria-expanded": expanded,
						"aria-label": t(expanded ? "changes.collapseAria" : "changes.expandAria", { count: String(changes.files.length) }),
						onClick: () => {
							setExpanded((value) => !value);
						},
						children: [(0, react_jsx_runtime.jsx)("span", { children: t(expanded ? "changes.collapse" : "changes.all", { count: String(changes.files.length) }) }), expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutlineRegular, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {})]
					})
				]
			});
		}
		/** Mounted only while its hover card is open, so passing over a row does not read a comparison. */
		function ChangedFilePreview({ sessionId, seq, index, display, useChangesDiff, loadChangesDiff, t }) {
			const state = useChangesDiff((value) => value[changesDiffUrl(sessionId, seq, index)]);
			(0, react.useEffect)(() => {
				if (state === void 0) loadChangesDiff(sessionId, seq, index);
			}, [
				state,
				sessionId,
				seq,
				index,
				loadChangesDiff
			]);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: `${FileDiff_module_css_default.root} ${ChangedFiles_module_css_default.preview}`,
				"data-changes-hover-preview": true,
				children: [(0, react_jsx_runtime.jsx)("div", {
					className: FileDiff_module_css_default.header,
					children: (0, react_jsx_runtime.jsx)("span", {
						className: ChangedFiles_module_css_default.previewPath,
						"data-changes-preview-path": true,
						children: display
					})
				}), (0, react_jsx_runtime.jsx)(FileDiff, {
					state,
					split: false,
					wrap: false,
					t,
					retry: () => {
						loadChangesDiff(sessionId, seq, index);
					}
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:D:\deepseek-harness\packages\client\ui-deliverables\src\client\Deliverables.module.css.mjs
		const css$1 = ".wV53za_root{--deliverable-fill:var(--dsw-static-neutral-50);--deliverable-hover:var(--dsw-static-neutral-100);flex-direction:column;gap:16px;min-width:0;margin-top:4px;display:flex;container-type:inline-size}.wV53za_root[data-after-changes=true]{margin-top:0}body[data-ds-dark-theme] .wV53za_root{--deliverable-fill:var(--dsw-static-neutral-850);--deliverable-hover:var(--dsw-static-neutral-800)}.wV53za_hostStatus{color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;font-size:12px;line-height:18px;display:flex}.wV53za_presented{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0;display:grid}.wV53za_presented[data-single=true]{grid-template-columns:minmax(0,1fr)}.wV53za_file{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--deliverable-fill);min-width:0;height:60px;color:var(--dsw-alias-label-primary);align-items:center;gap:10px;padding:8px 10px;transition:background-color .12s;display:flex;position:relative;overflow:hidden}.wV53za_file:hover{background:var(--deliverable-hover)}.wV53za_cardPreview{z-index:1;border-radius:inherit;cursor:pointer;background:0 0;border:0;width:100%;padding:0;position:absolute;inset:0}.wV53za_cardPreview:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none}.wV53za_fileIcon{z-index:2;box-sizing:border-box;pointer-events:none;border:.5px solid var(--dsw-alias-border-l1);background:color-mix(in srgb, var(--dsw-static-neutral-00) 50%, transparent);width:40px;height:40px;color:var(--dsw-alias-link);border-radius:10px;flex:none;place-items:center;display:grid;position:relative;overflow:hidden}body[data-ds-dark-theme] .wV53za_fileIcon{background:color-mix(in srgb, var(--dsw-static-neutral-00) 5%, transparent)}.wV53za_fileBody{z-index:2;pointer-events:none;flex:1;justify-content:space-between;align-items:center;gap:12px;min-width:0;display:flex;position:relative}.wV53za_details{flex-direction:column;flex:1;justify-content:center;gap:2px;min-width:0;display:flex}.wV53za_fileName{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}.wV53za_description{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:400;line-height:16px;overflow:hidden}.wV53za_description[data-error=true]{color:var(--dsw-alias-state-error-primary)}.wV53za_previewHint,.wV53za_file:hover .wV53za_description:not([role=status]) .wV53za_secondaryText{display:none}.wV53za_file:hover .wV53za_description:not([role=status]) .wV53za_previewHint{display:inline}.wV53za_toggle{border-radius:var(--dsw-radius-sm);min-width:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;background:0 0;border:0;align-self:center;align-items:center;gap:4px;padding:1px 11px;font-size:12px;line-height:18px;display:inline-flex}.wV53za_toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.wV53za_toggle svg{flex:none;width:14px;height:14px}@container (width<=620px){.wV53za_presented{grid-template-columns:minmax(0,1fr)}}.wV53za_actions{pointer-events:auto;flex:none;display:inline-flex}.wV53za_secondaryText[data-success]{animation-name:wV53za_success-fade;animation-timing-function:ease-out;animation-fill-mode:forwards}@keyframes wV53za_success-fade{to{opacity:0}}@media (prefers-reduced-motion:reduce){.wV53za_secondaryText[data-success]{animation-name:none}}";
		const tagId$1 = "@deepseek-ai/dsh-client-ui-deliverables/Deliverables.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-deliverables";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var Deliverables_module_css_default = {
			"actions": "wV53za_actions",
			"cardPreview": "wV53za_cardPreview",
			"description": "wV53za_description",
			"details": "wV53za_details",
			"file": "wV53za_file",
			"fileBody": "wV53za_fileBody",
			"fileIcon": "wV53za_fileIcon",
			"fileName": "wV53za_fileName",
			"hostStatus": "wV53za_hostStatus",
			"presented": "wV53za_presented",
			"previewHint": "wV53za_previewHint",
			"root": "wV53za_root",
			"secondaryText": "wV53za_secondaryText",
			"success-fade": "wV53za_success-fade",
			"toggle": "wV53za_toggle"
		};
		//#endregion
		//#region lib/types/client/PresentedFileCard.js
		function cardDescription(description, fallback) {
			const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, "").trim();
			return trimmed === void 0 || trimmed === "" ? fallback : trimmed;
		}
		/**
		* Render independent file actions without nesting buttons inside a clickable card.
		* @param props - durable file metadata, Sidebar preview, Host capabilities, gesture status, and localized copy.
		* @returns the file card and its anchored action menu.
		*/
		function PresentedFileCard({ file, cwd, phase, host, onPreview, actions, t }) {
			const succeeded = phase === "opened" || phase === "revealed";
			const reveal = host?.fileManager ?? "directory";
			const name = basename(file.path);
			const metadata = (0, _deepseek_ai_dsh_client_ui_primitives.fileExtension)(name).toUpperCase() || t("presented.file");
			const status = phase === void 0 ? cardDescription(file.description, metadata) : t(reveal === "directory" && phase === "revealed" ? "presented.directoryOpened" : reveal === "directory" && phase === "revealing" ? "presented.directoryOpening" : reveal === "directory" && phase === "revealError" ? "presented.directoryError" : `presented.${phase}`);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: Deliverables_module_css_default.file,
				"data-presented-file": true,
				children: [
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: Deliverables_module_css_default.cardPreview,
						title: resolveWorkspacePath(cwd, file.path),
						"aria-label": t("presented.previewCard", { name: file.path }),
						onClick: onPreview
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: Deliverables_module_css_default.fileIcon,
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
							path: file.path,
							size: 20
						})
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: Deliverables_module_css_default.fileBody,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: Deliverables_module_css_default.details,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: Deliverables_module_css_default.fileName,
								children: name
							}), (0, react_jsx_runtime.jsxs)("span", {
								className: Deliverables_module_css_default.description,
								"data-presented-description": true,
								role: phase === void 0 ? void 0 : "status",
								"data-error": phase === "error" || phase === "revealError" || phase === "nativeUnavailable" ? true : void 0,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: Deliverables_module_css_default.secondaryText,
									"data-success": succeeded || void 0,
									style: succeeded ? {
										animationDelay: `${PRESENTED_SUCCESS_HOLD_MS}ms`,
										animationDuration: `200ms`
									} : void 0,
									children: status
								}), (0, react_jsx_runtime.jsx)("span", {
									className: Deliverables_module_css_default.previewHint,
									children: t("presented.preview")
								})]
							})]
						}), (0, react_jsx_runtime.jsx)("div", {
							className: Deliverables_module_css_default.actions,
							children: actions
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/Deliverables.js
		/** The changed-files card, shown only while the Host serves the turn's summary, and explicitly declared files for a closing turn. */
		const COLLAPSED_PRESENTED_COUNT = 4;
		/**
		* Claim turns with a change announcement or declared files.
		* @param owner - closing turn.
		* @returns matched announcement and deliveries, or null for a turn with neither.
		*/
		function selectDeliverables(owner) {
			const changes = changesForClosing(owner);
			const presented = presentedForClosing(owner);
			return changes === null && presented.length === 0 ? null : {
				changes,
				presented
			};
		}
		/**
		* Contribute file deliveries alongside other completed-Turn artifacts.
		* @param props - closing Turn, file actions, and localized copy.
		* @returns file rows, or null when the Turn declares none.
		*/
		function DeliverablesTail(props) {
			const matched = selectDeliverables(props);
			return matched === null ? null : (0, react_jsx_runtime.jsx)(Deliverables, {
				...props,
				matched
			});
		}
		/**
		* Render the changed-files card, once the Host has served the announced
		* summary and it lists a file, and shared native opening controls for declared
		* files. A summary the Host no longer serves leaves no card.
		* @param props - matched announcement and files, workspace opener, and localized copy.
		* @returns the closing turn's file rows.
		*/
		function Deliverables({ matched, openFile, t, sessionId, useSessions, openPresented, openChangesReview, usePresentedOpen, usePresentedHost, useChangesDiff, loadChangesDiff, useChangesSummary, reloadPresentedHost, loadChangesSummary, useShowCodeDiff, renderSlot }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const showCodeDiff = useShowCodeDiff((value) => value);
			const cwd = useSessions((state) => state.byId[sessionId]?.cwd);
			const states = usePresentedOpen((value) => value);
			const host = usePresentedHost((value) => value);
			const announced = showCodeDiff ? matched.changes : null;
			const summary = useChangesSummary((value) => announced === null ? void 0 : value[changesSummaryUrl(sessionId, announced.seq)]);
			(0, react.useEffect)(() => {
				if (announced !== null && summary === void 0) loadChangesSummary(sessionId, announced.seq);
			}, [
				announced,
				summary,
				sessionId,
				loadChangesSummary
			]);
			const changes = announced !== null && typeof summary === "object" && summary.files.length > 0 ? {
				seq: announced.seq,
				...summary
			} : null;
			const collapsible = matched.presented.length > COLLAPSED_PRESENTED_COUNT;
			const presented = collapsible && !expanded ? matched.presented.slice(0, COLLAPSED_PRESENTED_COUNT) : matched.presented;
			(0, react.useEffect)(() => {
				if (host === null) reloadPresentedHost();
			}, [host, reloadPresentedHost]);
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [changes !== null && (0, react_jsx_runtime.jsx)(ChangedFiles, {
				changes,
				cwd,
				t,
				sessionId,
				useChangesDiff,
				loadChangesDiff,
				openReview: (index) => {
					openChangesReview({
						sessionId,
						seq: changes.seq,
						turn: changes.turn
					}, index);
				}
			}), matched.presented.length > 0 && (0, react_jsx_runtime.jsxs)("div", {
				className: Deliverables_module_css_default.root,
				"data-after-changes": changes !== null || void 0,
				children: [
					host === "error" && (0, react_jsx_runtime.jsxs)("div", {
						className: Deliverables_module_css_default.hostStatus,
						children: [(0, react_jsx_runtime.jsx)("span", { children: t("presented.hostError") }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							onClick: () => {
								reloadPresentedHost();
							},
							children: t("presented.retry")
						})]
					}),
					host !== null && host !== "error" && !host.available && (0, react_jsx_runtime.jsx)("span", {
						className: Deliverables_module_css_default.hostStatus,
						children: t("presented.unavailable")
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: Deliverables_module_css_default.presented,
						"data-presented-files-row": true,
						"data-single": matched.presented.length === 1 ? true : void 0,
						children: presented.map((file) => (0, react_jsx_runtime.jsx)(PresentedFileCard, {
							file,
							cwd,
							phase: states[presentedFileUrl(sessionId, file.seq, file.index)],
							host: host === "error" ? null : host,
							t,
							onPreview: () => {
								openFile(file.path);
							},
							actions: renderSlot("deliverables.file.actions", {
								actionUrl: presentedFileUrl(sessionId, file.seq, file.index),
								available: host !== null && host !== "error" && host.available,
								pending: states[presentedFileUrl(sessionId, file.seq, file.index)] === "opening" || states[presentedFileUrl(sessionId, file.seq, file.index)] === "revealing",
								onAction: (action, application) => openPresented(sessionId, file.seq, file.index, action, application)
							})
						}, `${file.seq}:${file.index}`))
					}),
					collapsible && (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: Deliverables_module_css_default.toggle,
						"aria-expanded": expanded,
						"aria-label": t(expanded ? "presented.collapseAria" : "presented.expandAria", { count: matched.presented.length }),
						onClick: () => {
							setExpanded((value) => !value);
						},
						children: [(0, react_jsx_runtime.jsx)("span", { children: t(expanded ? "presented.collapse" : "presented.all", { count: matched.presented.length }) }), expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutlineRegular, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {})]
					})
				]
			})] });
		}
		//#endregion
		//#region \0dsh-css:D:\deepseek-harness\packages\client\ui-deliverables\src\client\ReviewTab.module.css.mjs
		const css = ".tHbTsG_root{height:100%}.tHbTsG_selector{flex:0 auto;min-width:0}.tHbTsG_selectorLabel{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;font-size:12px;overflow:hidden}.tHbTsG_selectorButton{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;background:0 0;border:0;align-items:center;gap:4px;padding:0 6px 0 8px;font-size:12px;line-height:20px;display:inline-flex}.tHbTsG_selectorButton:hover,.tHbTsG_selectorButton[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.tHbTsG_selectorButton svg{flex:none;display:block}.tHbTsG_item{justify-content:space-between;align-items:center;gap:12px;min-width:0;display:flex}.tHbTsG_itemPath{text-overflow:ellipsis;white-space:nowrap;min-width:0;line-height:20px;overflow:hidden}.tHbTsG_itemCounts,.tHbTsG_counts{font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:6px;font-size:12px;line-height:20px;display:inline-flex}.tHbTsG_counts{min-width:0;margin-right:auto}.tHbTsG_added{color:var(--dsw-alias-state-success-primary)}.tHbTsG_deleted{color:var(--dsw-alias-state-error-primary)}.tHbTsG_label{color:var(--dsw-alias-label-tertiary)}.tHbTsG_tools{flex:none;align-items:center;gap:2px;margin-left:auto;display:inline-flex}.tHbTsG_tool{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}.tHbTsG_tool svg{width:15px;height:15px}.tHbTsG_tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.tHbTsG_tool[aria-pressed=true] .tHbTsG_compareIcon{transform:rotate(90deg)}.tHbTsG_tool:disabled{cursor:progress}.tHbTsG_tool[data-error]{color:var(--dsw-alias-state-error-primary)}";
		const tagId = "@deepseek-ai/dsh-client-ui-deliverables/ReviewTab.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-deliverables";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ReviewTab_module_css_default = {
			"added": "tHbTsG_added",
			"compareIcon": "tHbTsG_compareIcon",
			"counts": "tHbTsG_counts",
			"deleted": "tHbTsG_deleted",
			"item": "tHbTsG_item",
			"itemCounts": "tHbTsG_itemCounts",
			"itemPath": "tHbTsG_itemPath",
			"label": "tHbTsG_label",
			"root": "tHbTsG_root",
			"selector": "tHbTsG_selector",
			"selectorButton": "tHbTsG_selectorButton",
			"selectorLabel": "tHbTsG_selectorLabel",
			"tool": "tHbTsG_tool",
			"tools": "tHbTsG_tools"
		};
		//#endregion
		//#region lib/types/client/ReviewTab.js
		/**
		* The review tab: one turn's changed files behind a file selector, with the
		* selected file's turn-start and turn-end comparison drawn unified or side by
		* side, wrapped or scrolling, and controls to open the file itself.
		*/
		const GROUPED = new Intl.NumberFormat("en-US");
		/** The file index a navigation names, when it names one. */
		function navigatedIndex(params) {
			const index = params?.index;
			return typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? index : void 0;
		}
		/** Added and deleted line counts in the card's colors. */
		function Counts({ file, t }) {
			if (file.binary === true) return (0, react_jsx_runtime.jsx)("span", {
				className: ReviewTab_module_css_default.label,
				children: t("changes.binary")
			});
			if (file.oversized === true) return (0, react_jsx_runtime.jsx)("span", {
				className: ReviewTab_module_css_default.label,
				children: t("changes.oversized")
			});
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
				className: ReviewTab_module_css_default.added,
				children: t("changes.added", { count: GROUPED.format(file.added) })
			}), (0, react_jsx_runtime.jsx)("span", {
				className: ReviewTab_module_css_default.deleted,
				children: t("changes.deleted", { count: GROUPED.format(file.deleted) })
			})] });
		}
		/**
		* The review type's body, registered under `sidebar.right.pane.tab` as `changes-review`.
		* @param props - composed slot props.
		* @returns the selected file's comparison behind the file selector, or the state that stands in for it.
		*/
		function ReviewTab({ useTabInfo, sessionId, useSessions, useStore, actions, useChangesSummary, useChangesDiff, usePresentedOpen, usePresentedHost, loadChangesSummary, loadChangesDiff, reloadPresentedHost, openChanged, t, renderSlot }) {
			const { tab } = useTabInfo();
			const { navigation, signal } = tab;
			const coordinates = (0, react.useMemo)(() => parseChangesReviewAddress(tab.contentId), [tab.contentId]);
			if (coordinates === void 0) throw new Error(`ui-deliverables: not a review address "${tab.contentId}"`);
			const { seq } = coordinates;
			const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);
			const summary = useChangesSummary((value) => value[changesSummaryUrl(sessionId, seq)]);
			const state = useStore((store) => store.byTab[tab.id]);
			const host = usePresentedHost((value) => value);
			(0, react.useEffect)(() => {
				if (state?.navigated === navigation.revision) return;
				actions.navigated(tab.id, navigation.revision, navigatedIndex(navigation.params) ?? state?.index ?? 0);
			}, [
				state,
				navigation.revision,
				navigation.params,
				actions,
				tab.id
			]);
			(0, react.useEffect)(() => {
				const forget = () => {
					actions.forget(tab.id);
				};
				signal.addEventListener("abort", forget, { once: true });
				return () => {
					signal.removeEventListener("abort", forget);
				};
			}, [
				signal,
				actions,
				tab.id
			]);
			(0, react.useEffect)(() => {
				if (summary === void 0) loadChangesSummary(sessionId, seq);
			}, [
				summary,
				sessionId,
				seq,
				loadChangesSummary
			]);
			(0, react.useEffect)(() => {
				if (host === null) reloadPresentedHost();
			}, [host, reloadPresentedHost]);
			const files = typeof summary === "object" ? summary.files : [];
			const index = state !== void 0 && files[state.index] !== void 0 ? state.index : 0;
			const file = files[index];
			const diffState = useChangesDiff((value) => file === void 0 ? void 0 : value[changesDiffUrl(sessionId, seq, index)]);
			(0, react.useEffect)(() => {
				if (file !== void 0 && diffState === void 0) loadChangesDiff(sessionId, seq, index);
			}, [
				file,
				diffState,
				sessionId,
				seq,
				index,
				loadChangesDiff
			]);
			const phase = usePresentedOpen((value) => file === void 0 ? void 0 : value[changedFileUrl(sessionId, seq, index)]);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const split = state?.split === true;
			const wrap = state?.wrap === true;
			const native = host !== null && host !== "error" && host.available && phase !== "nativeUnavailable";
			const summaryState = summary === void 0 || summary === "loading" ? "loading" : summary === "missing" ? "missing" : "ready";
			return (0, react_jsx_runtime.jsxs)("div", {
				className: `${FileDiff_module_css_default.root} ${ReviewTab_module_css_default.root}`,
				"data-changes-review": true,
				"data-review-state": summaryState,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: FileDiff_module_css_default.header,
						children: [
							file === void 0 ? (0, react_jsx_runtime.jsx)("span", {
								className: ReviewTab_module_css_default.selectorLabel,
								children: t("review.title", { turn: String(coordinates.turn) })
							}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
								className: ReviewTab_module_css_default.selector,
								open: menuOpen,
								autoFocus: true,
								portal: true,
								align: "start",
								dense: true,
								onClose: () => {
									setMenuOpen(false);
								},
								anchor: (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: ReviewTab_module_css_default.selectorButton,
									"aria-haspopup": "menu",
									"aria-expanded": menuOpen,
									"aria-label": t("review.selectFile"),
									title: file.display,
									"data-review-file": file.path,
									onClick: () => {
										setMenuOpen((value) => !value);
									},
									children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.PathLabel, { path: file.display }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })]
								}),
								items: files.map((entry, at) => ({
									id: String(at),
									label: (0, react_jsx_runtime.jsxs)("span", {
										className: ReviewTab_module_css_default.item,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: ReviewTab_module_css_default.itemPath,
											children: entry.display
										}), (0, react_jsx_runtime.jsx)("span", {
											className: ReviewTab_module_css_default.itemCounts,
											children: (0, react_jsx_runtime.jsx)(Counts, {
												file: entry,
												t
											})
										})]
									})
								})),
								selectedId: String(index),
								onSelect: (id) => {
									actions.selected(tab.id, Number(id));
									setMenuOpen(false);
								}
							}),
							file !== void 0 && (0, react_jsx_runtime.jsx)("span", {
								className: ReviewTab_module_css_default.counts,
								children: (0, react_jsx_runtime.jsx)(Counts, {
									file,
									t
								})
							}),
							(0, react_jsx_runtime.jsxs)("span", {
								className: ReviewTab_module_css_default.tools,
								children: [
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
										label: t(split ? "review.unified" : "review.split"),
										side: "bottom",
										delayMs: 500,
										children: (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: ReviewTab_module_css_default.tool,
											"aria-pressed": split,
											"aria-label": t("review.splitAria"),
											"data-review-tool": "split",
											onClick: () => {
												actions.toggledSplit(tab.id);
											},
											children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCompareSplitOutlineRegular, { className: ReviewTab_module_css_default.compareIcon })
										})
									}),
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
										label: t(wrap ? "review.nowrap" : "review.wrap"),
										side: "bottom",
										delayMs: 500,
										children: (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: ReviewTab_module_css_default.tool,
											"aria-pressed": wrap,
											"aria-label": t("review.wrapAria"),
											"data-review-tool": "wrap",
											onClick: () => {
												actions.toggledWrap(tab.id);
											},
											children: wrap ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNowrapFillRegular, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWrapFillRegular, {})
										})
									}),
									file !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
										label: t("review.openFile"),
										side: "bottom",
										delayMs: 500,
										children: (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: ReviewTab_module_css_default.tool,
											"aria-label": t("review.openFileAria", { name: file.display }),
											"data-review-tool": "open-file",
											onClick: () => {
												tab.actions.openResource(fileAddressFor(sessionId, cwd, file.path));
											},
											children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconInspectOutlineRegular, {})
										})
									}),
									file !== void 0 && renderSlot("deliverables.review.file.actions", {
										actionUrl: changedFileUrl(sessionId, seq, index),
										available: native,
										pending: phase === "opening" || phase === "revealing",
										onAction: (action, application) => openChanged(sessionId, seq, index, action, application)
									})
								]
							})
						]
					}),
					summaryState === "loading" && (0, react_jsx_runtime.jsx)("p", {
						className: FileDiff_module_css_default.status,
						role: "status",
						children: t("diff.loading")
					}),
					summaryState === "missing" && (0, react_jsx_runtime.jsx)("p", {
						className: FileDiff_module_css_default.status,
						children: t("diff.missing")
					}),
					file !== void 0 && (0, react_jsx_runtime.jsx)(FileDiff, {
						state: diffState,
						split,
						wrap,
						t,
						retry: () => {
							loadChangesDiff(sessionId, seq, index);
						}
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/review-definition.js
		/** The tab kind this package owns. */
		const CHANGES_REVIEW_KIND = "changes-review";
		/** This implementation's identity in the tab system, and the key its body registers under. */
		const CHANGES_REVIEW_ID = "@deepseek-ai/dsh-client-ui-deliverables";
		/**
		* The review type's registry definition.
		* @param t - namespace-bound translate, read fresh on every title call.
		* @returns the definition to register.
		*/
		function changesReviewDefinition(t) {
			return {
				id: CHANGES_REVIEW_ID,
				kind: CHANGES_REVIEW_KIND,
				patterns: ["dsh-resource://changes-review/**"],
				priority: "builtin",
				canOpen: (address) => parseChangesReviewAddress(address) !== void 0,
				title: (address) => {
					const turn = parseChangesReviewAddress(address)?.turn;
					return turn === void 0 ? address : t("review.title", { turn: String(turn) });
				}
			};
		}
		//#endregion
		//#region lib/types/client/review-store.js
		/**
		* The review tab's view state: which listed file is shown, whether hunks are
		* drawn side by side, and whether long lines wrap. One bucket per tab, so two
		* reviews in one session keep their own choices; the bucket ends with the
		* tab record's signal.
		*/
		function bucket(state, tabId) {
			const tab = state.byTab[tabId];
			if (tab === void 0) throw new Error(`ui-deliverables: no review state for tab "${tabId}"`);
			return tab;
		}
		/**
		* Declare the review tab's store; the registration declares it as an
		* exclusive store, so the framework mints one instance per session.
		* @returns the store handle to declare on the registration.
		*/
		function createReviewStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({ byTab: {} }),
				actions: {
					/**
					* Apply a navigation: seed a side-by-side, unwrapped tab on its first one, then show the navigated file.
					* @param d - draft state.
					* @param tabId - the tab being drawn.
					* @param revision - the navigation revision being applied.
					* @param index - the file index the navigation named, or the current one.
					*/
					navigated: (d, tabId, revision, index) => {
						const tab = d.byTab[tabId];
						if (tab === void 0) d.byTab[tabId] = {
							index,
							split: true,
							wrap: false,
							navigated: revision
						};
						else {
							tab.index = index;
							tab.navigated = revision;
						}
					},
					/**
					* Show another listed file.
					* @param d - draft state.
					* @param tabId - the tab being drawn.
					* @param index - original index in the summary's files array.
					*/
					selected: (d, tabId, index) => {
						bucket(d, tabId).index = index;
					},
					/**
					* Switch between the unified and the side-by-side view.
					* @param d - draft state.
					* @param tabId - the tab being drawn.
					*/
					toggledSplit: (d, tabId) => {
						const tab = bucket(d, tabId);
						tab.split = !tab.split;
					},
					/**
					* Switch line wrapping.
					* @param d - draft state.
					* @param tabId - the tab being drawn.
					*/
					toggledWrap: (d, tabId) => {
						const tab = bucket(d, tabId);
						tab.wrap = !tab.wrap;
					},
					/**
					* Drop a tab's bucket once its record is gone.
					* @param d - draft state.
					* @param tabId - the tab that ended.
					*/
					forget: (d, tabId) => {
						d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId));
					}
				}
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** `deliverables` namespace dictionaries: cards, comparison tab, and file-mention copy. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "deliverables";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"presented.nativeUnavailable": "此文件没有可用的主机路径，请在侧边栏预览",
			"presented.revealError": "无法在文件管理器中显示，请重试",
			"presented.directoryError": "无法打开所在文件夹，请重试",
			"presented.directoryOpening": "正在打开所在文件夹…",
			"presented.directoryOpened": "已请求打开所在文件夹",
			"presented.revealed": "已请求在文件管理器中显示",
			"presented.revealing": "正在文件管理器中显示…",
			"presented.unavailable": "此主机没有可用的桌面，无法使用外部程序打开文件或文件夹；文件仍可在侧边栏预览",
			"presented.retry": "重试",
			"presented.hostError": "无法读取主机桌面信息",
			"presented.preview": "在侧边栏预览",
			"presented.previewButton": "在侧边栏打开 {name}",
			"presented.previewCard": "在侧边栏预览 {name}",
			"presented.all": "全部 {count} 个文件",
			"presented.expandAria": "展开全部 {count} 个交付文件",
			"presented.collapse": "收起",
			"presented.collapseAria": "收起交付文件列表",
			"presented.opening": "正在打开…",
			"presented.opened": "已请求打开",
			"presented.error": "打开失败，点击重试",
			"presented.file": "文件",
			"row.title": "交付文件",
			"row.running": "正在交付",
			"row.preparing": "准备交付",
			"row.ok": "已交付",
			"row.error": "交付失败",
			"row.stopped": "已中断",
			"row.inspect": "查看调用",
			"changes.title": "已编辑 {count} 个文件",
			"changes.singleTitle": "已编辑 {name}",
			"changes.added": "+{count}",
			"changes.deleted": "-{count}",
			"changes.binary": "二进制",
			"changes.openReview": "在侧边栏查看本轮改动",
			"changes.all": "全部 {count} 个文件",
			"changes.expandAria": "展开全部 {count} 个改动文件",
			"changes.collapse": "收起",
			"changes.collapseAria": "收起改动文件列表",
			"changes.oversized": "过大",
			"changes.viewDiff": "查看 {name} 的改动",
			"review.title": "第 {turn} 轮改动",
			"review.selectFile": "选择要查看的文件",
			"review.split": "切换为左右对比",
			"review.unified": "切换为单栏对比",
			"review.splitAria": "左右对比",
			"review.wrap": "开启自动换行",
			"review.nowrap": "关闭自动换行",
			"review.wrapAria": "自动换行",
			"review.openFile": "在侧边栏打开整个文件",
			"review.openFileAria": "在侧边栏打开 {name}",
			"diff.loading": "正在读取改动…",
			"diff.missing": "这轮改动的内容已不可用",
			"diff.error": "无法读取改动",
			"diff.binary": "二进制文件，无法显示改动",
			"diff.oversized": "文件过大，无法显示改动",
			"diff.created": "本轮新建的文件",
			"diff.deleted": "本轮删除的文件",
			"diff.unchanged": "两侧内容相同",
			"diff.coarse": "逐行对比超时，按整个文件替换显示",
			"diff.truncated": "只显示前 {count} 行"
		};
		/** English dictionary (same key set). */
		const en = {
			"presented.nativeUnavailable": "This file has no available Host path. Preview it in the sidebar.",
			"presented.revealError": "Could not show in file manager. Try again.",
			"presented.directoryError": "Could not open containing folder. Try again.",
			"presented.directoryOpening": "Opening containing folder…",
			"presented.directoryOpened": "Requested opening containing folder",
			"presented.revealed": "Requested display in file manager",
			"presented.revealing": "Showing in file manager…",
			"presented.unavailable": "This Host has no desktop available to open files or folders in external apps. Files can still be previewed in the sidebar.",
			"presented.retry": "Retry",
			"presented.hostError": "Could not read the Host desktop information",
			"presented.preview": "Preview in sidebar",
			"presented.previewButton": "Open {name} in sidebar",
			"presented.previewCard": "Preview {name} in sidebar",
			"presented.all": "All {count} files",
			"presented.expandAria": "Show all {count} delivered files",
			"presented.collapse": "Collapse",
			"presented.collapseAria": "Collapse delivered files",
			"presented.opening": "Opening…",
			"presented.opened": "Open requested",
			"presented.error": "Could not open. Click to retry.",
			"presented.file": "File",
			"row.title": "Present files",
			"row.running": "Delivering",
			"row.preparing": "Preparing deliverables",
			"row.ok": "Delivered",
			"row.error": "Delivery failed",
			"row.stopped": "Interrupted",
			"row.inspect": "Inspect call",
			"changes.title": "Edited {count} files",
			"changes.singleTitle": "Edited {name}",
			"changes.added": "+{count}",
			"changes.deleted": "-{count}",
			"changes.binary": "binary",
			"changes.openReview": "Review this turn’s changes in the sidebar",
			"changes.all": "All {count} files",
			"changes.expandAria": "Show all {count} changed files",
			"changes.collapse": "Collapse",
			"changes.collapseAria": "Collapse changed files",
			"changes.oversized": "too large",
			"changes.viewDiff": "View changes to {name}",
			"review.title": "Review · turn {turn}",
			"review.selectFile": "Choose the file to review",
			"review.split": "Switch to split view",
			"review.unified": "Switch to unified view",
			"review.splitAria": "Split view",
			"review.wrap": "Enable line wrap",
			"review.nowrap": "Disable line wrap",
			"review.wrapAria": "Line wrap",
			"review.openFile": "Open the whole file in the sidebar",
			"review.openFileAria": "Open {name} in sidebar",
			"diff.loading": "Reading changes…",
			"diff.missing": "The contents of this turn’s changes are no longer available",
			"diff.error": "Could not read the changes",
			"diff.binary": "Binary file; changes cannot be shown",
			"diff.oversized": "File too large; changes cannot be shown",
			"diff.created": "Created in this turn",
			"diff.deleted": "Deleted in this turn",
			"diff.unchanged": "Both sides hold the same lines",
			"diff.coarse": "Line comparison timed out; shown as a whole-file replacement",
			"diff.truncated": "Showing the first {count} lines"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Required services for the tail-slot and tab-type registrations and their dictionaries. */
		const inject = [
			"slots",
			"locale",
			"uiConversation",
			"remote",
			"remote.session",
			"sidebarRightTabs",
			"sidebarRight",
			"configForms"
		];
		/**
		* Client plugin body: register the dictionaries, the turn-tail entry, and the comparison tab type.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const opener = new PresentedOpenController();
			const summaries = new ChangesSummaryStore();
			const diffs = new ChangesDiffStore();
			ctx.effect(() => () => Promise.all([
				opener.dispose(),
				summaries.dispose(),
				diffs.dispose()
			]));
			ctx.on("connection/reset", () => {
				opener.resetHost();
				summaries.reset();
				diffs.reset();
			});
			ctx.uiConversation.events.register(deliverablesDefinition);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-deliverables: dictionaries");
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				id: "@deepseek-ai/dsh-client-ui-deliverables",
				locale: NS,
				children: { "deliverables.file.actions": {
					kind: "list",
					scope: "session"
				} },
				inject: () => ({
					hooks: {
						changesDiff: diffs.state,
						presentedOpen: opener.state,
						presentedHost: opener.host,
						changesSummary: summaries.state,
						showCodeDiff: ctx.configForms.developerTools.enabled
					},
					loadChangesDiff: (sessionId, seq, index) => diffs.load(sessionId, seq, index),
					reloadPresentedHost: () => opener.loadHost(),
					loadChangesSummary: (sessionId, seq) => summaries.load(sessionId, seq),
					openPresented: (sessionId, seq, index, action, application) => opener.open(sessionId, seq, index, action, application),
					openChanged: (sessionId, seq, index, action, application) => opener.openChanged(sessionId, seq, index, action, application),
					openChangesReview: (coordinates, index) => {
						ctx.sidebarRight.openResource(changesReviewAddress(coordinates), { params: { index } });
					}
				})
			}, DeliverablesTail));
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: "present",
				locale: NS
			}, PresentRow));
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.sidebarRightTabs.register(changesReviewDefinition(t)), "ui-deliverables: changes-review type");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: CHANGES_REVIEW_ID,
				locale: NS,
				store: createReviewStore(),
				children: { "deliverables.review.file.actions": {
					kind: "list",
					scope: "session"
				} },
				inject: () => ({
					hooks: {
						changesSummary: summaries.state,
						changesDiff: diffs.state,
						presentedOpen: opener.state,
						presentedHost: opener.host
					},
					loadChangesSummary: (sessionId, seq) => summaries.load(sessionId, seq),
					loadChangesDiff: (sessionId, seq, index) => diffs.load(sessionId, seq, index),
					reloadPresentedHost: () => opener.loadHost(),
					openChanged: (sessionId, seq, index, action, application) => opener.openChanged(sessionId, seq, index, action, application)
				})
			}, ReviewTab)), "ui-deliverables: changes-review body");
			ctx.provide("chatFileMentions", { forClosing(owner) {
				const paths = selectProducedFiles(owner);
				const presented = presentedForClosing(owner);
				if (paths === null && presented.length === 0) return void 0;
				return producedFileMentions([...new Set([...paths ?? [], ...presented.map((file) => file.path)])], owner.openFile, (path) => t("presented.previewButton", { name: path }));
			} });
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-typert-registry",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		"captureStackTrace" in Error && Error.captureStackTrace;
		Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -Number.MAX_VALUE, Number.MAX_VALUE;
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
			else result.definitions = defs;
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time") delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const regexes = [...patterns];
				if (regexes.length === 1) json.pattern = regexes[0].source;
				else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
			if (typeof format === "string" && format.includes("int")) json.type = "integer";
			else json.type = "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) if (legacy) {
				json.minimum = exclusiveMinimum;
				json.exclusiveMinimum = true;
			} else json.exclusiveMinimum = exclusiveMinimum;
			else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) if (legacy) {
				json.maximum = exclusiveMaximum;
				json.exclusiveMaximum = true;
			} else json.exclusiveMaximum = exclusiveMaximum;
			else if (typeof maximum === "number") json.maximum = maximum;
			if (typeof multipleOf === "number") json.multipleOf = multipleOf;
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const bigintProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("BigInt cannot be represented in JSON Schema");
		};
		const symbolProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Symbols cannot be represented in JSON Schema");
		};
		const nullProcessor = (_schema, ctx, json, _params) => {
			if (ctx.target === "openapi-3.0") {
				json.type = "string";
				json.nullable = true;
				json.enum = [null];
			} else json.type = "null";
		};
		const undefinedProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Undefined cannot be represented in JSON Schema");
		};
		const voidProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Void cannot be represented in JSON Schema");
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const anyProcessor = (_schema, _ctx, _json, _params) => {};
		const unknownProcessor = (_schema, _ctx, _json, _params) => {};
		const dateProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Date cannot be represented in JSON Schema");
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const literalProcessor = (schema, ctx, json, _params) => {
			const def = schema._zod.def;
			const vals = [];
			for (const val of def.values) if (val === void 0) {
				if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
			} else if (typeof val === "bigint") if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
			else vals.push(Number(val));
			else vals.push(val);
			if (vals.length === 0) {} else if (vals.length === 1) {
				const val = vals[0];
				json.type = val === null ? "null" : typeof val;
				if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
				else json.const = val;
			} else {
				if (vals.every((v) => typeof v === "number")) json.type = "number";
				if (vals.every((v) => typeof v === "string")) json.type = "string";
				if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
				if (vals.every((v) => v === null)) json.type = "null";
				json.enum = vals;
			}
		};
		const nanProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("NaN cannot be represented in JSON Schema");
		};
		const templateLiteralProcessor = (schema, _ctx, json, _params) => {
			const _json = json;
			const pattern = schema._zod.pattern;
			if (!pattern) throw new Error("Pattern not found in template literal");
			_json.type = "string";
			_json.pattern = pattern.source;
		};
		const fileProcessor = (schema, _ctx, json, _params) => {
			const _json = json;
			const file = {
				type: "string",
				format: "binary",
				contentEncoding: "binary"
			};
			const { minimum, maximum, mime } = schema._zod.bag;
			if (minimum !== void 0) file.minLength = minimum;
			if (maximum !== void 0) file.maxLength = maximum;
			if (mime) if (mime.length === 1) {
				file.contentMediaType = mime[0];
				Object.assign(_json, file);
			} else {
				Object.assign(_json, file);
				_json.anyOf = mime.map((m) => ({ contentMediaType: m }));
			}
			else Object.assign(_json, file);
		};
		const successProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const functionProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Function types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const mapProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Map cannot be represented in JSON Schema");
		};
		const setProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Set cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			json.properties = {};
			const shape = def.shape;
			for (const key in shape) json.properties[key] = process(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			});
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const v = def.shape[key]._zod;
				if (ctx.io === "input") return v.optin === void 0;
				else return v.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const tupleProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "array";
			const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
			const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
			const prefixItems = def.items.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					prefixPath,
					i
				]
			}));
			const rest = def.rest ? process(def.rest, ctx, {
				...params,
				path: [
					...params.path,
					restPath,
					...ctx.target === "openapi-3.0" ? [def.items.length] : []
				]
			}) : null;
			if (ctx.target === "draft-2020-12") {
				json.prefixItems = prefixItems;
				if (rest) json.items = rest;
			} else if (ctx.target === "openapi-3.0") {
				json.items = { anyOf: prefixItems };
				if (rest) json.items.anyOf.push(rest);
				json.minItems = prefixItems.length;
				if (!rest) json.maxItems = prefixItems.length;
			} else {
				json.items = prefixItems;
				if (rest) json.additionalItems = rest;
			}
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
		};
		const recordProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			const keyType = def.keyType;
			const patterns = keyType._zod.bag?.patterns;
			if (def.mode === "loose" && patterns && patterns.size > 0) {
				const valueSchema = process(def.valueType, ctx, {
					...params,
					path: [
						...params.path,
						"patternProperties",
						"*"
					]
				});
				json.patternProperties = {};
				for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
			} else {
				if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process(def.keyType, ctx, {
					...params,
					path: [...params.path, "propertyNames"]
				});
				json.additionalProperties = process(def.valueType, ctx, {
					...params,
					path: [...params.path, "additionalProperties"]
				});
			}
			const keyValues = keyType._zod.values;
			if (keyValues) {
				const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
				if (validKeyValues.length > 0) json.required = validKeyValues;
			}
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const promiseProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const lazyProcessor = (schema, ctx, _json, params) => {
			const innerType = schema._zod.innerType;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const allProcessors = {
			string: stringProcessor,
			number: numberProcessor,
			boolean: booleanProcessor,
			bigint: bigintProcessor,
			symbol: symbolProcessor,
			null: nullProcessor,
			undefined: undefinedProcessor,
			void: voidProcessor,
			never: neverProcessor,
			any: anyProcessor,
			unknown: unknownProcessor,
			date: dateProcessor,
			enum: enumProcessor,
			literal: literalProcessor,
			nan: nanProcessor,
			template_literal: templateLiteralProcessor,
			file: fileProcessor,
			success: successProcessor,
			custom: customProcessor,
			function: functionProcessor,
			transform: transformProcessor,
			map: mapProcessor,
			set: setProcessor,
			array: arrayProcessor,
			object: objectProcessor,
			union: unionProcessor,
			intersection: intersectionProcessor,
			tuple: tupleProcessor,
			record: recordProcessor,
			nullable: nullableProcessor,
			nonoptional: nonoptionalProcessor,
			default: defaultProcessor,
			prefault: prefaultProcessor,
			catch: catchProcessor,
			pipe: pipeProcessor,
			readonly: readonlyProcessor,
			promise: promiseProcessor,
			optional: optionalProcessor,
			lazy: lazyProcessor
		};
		function toJSONSchema(input, params) {
			if ("_idmap" in input) {
				const registry = input;
				const ctx = initializeContext({
					...params,
					processors: allProcessors
				});
				const defs = {};
				for (const entry of registry._idmap.entries()) {
					const [_, schema] = entry;
					process(schema, ctx);
				}
				const schemas = {};
				ctx.external = {
					registry,
					uri: params?.uri,
					defs
				};
				for (const entry of registry._idmap.entries()) {
					const [key, schema] = entry;
					extractDefs(ctx, schema);
					schemas[key] = finalize(ctx, schema);
				}
				if (Object.keys(defs).length > 0) schemas.__shared = { [ctx.target === "draft-2020-12" ? "$defs" : "definitions"]: defs };
				return { schemas };
			}
			const ctx = initializeContext({
				...params,
				processors: allProcessors
			});
			process(input, ctx);
			extractDefs(ctx, input);
			return finalize(ctx, input);
		}
		//#endregion
		//#region lib/types/service.js
		/**
		* Runtime registry for generated Typert reflection, Remote invocations, and
		* dependency-inverted lookup/Context providers. It performs no TypeScript
		* analysis or schema generation.
		* @module @deepseek-ai/dsh-typert-registry
		*/
		/**
		* Compose the global key of one generated schema.
		* @param packageName - contributing npm package.
		* @param name - schema export name.
		* @returns `<package>#<name>`.
		*/
		function typertKey(packageName, name) {
			return `${packageName}#${name}`;
		}
		/**
		* Compose the identity of one package-face model.
		* @param packageName - contributing npm package.
		* @param face - independently compiled face.
		* @returns `<package>#<face>`.
		*/
		function typertPackageKey(packageName, face) {
			return `${packageName}#${face}`;
		}
		/**
		* Compose the endpoint key used by local and Remote invocation registries.
		* @param descriptor - invocation whose namespace and method form the endpoint.
		* @returns `<namespace>/<method>`.
		*/
		function typertEndpoint(descriptor) {
			return `${descriptor.namespace}/${descriptor.method}`;
		}
		var ChangeSource = class {
			report;
			listeners = /* @__PURE__ */ new Set();
			constructor(report) {
				this.report = report;
			}
			subscribe(ctx, listener) {
				const { listeners } = this;
				return ctx.effect(function* () {
					listeners.add(listener);
					yield () => {
						listeners.delete(listener);
					};
				}, "typert registry subscription");
			}
			emit(change) {
				for (const listener of [...this.listeners]) try {
					listener(change);
				} catch (error) {
					this.report(change, error);
				}
			}
		};
		var DescriptorStore = class {
			kind;
			entries = /* @__PURE__ */ new Map();
			ids = /* @__PURE__ */ new Map();
			history = /* @__PURE__ */ new Set();
			changes;
			constructor(kind, report) {
				this.kind = kind;
				this.changes = new ChangeSource(report);
			}
			validate(descriptors) {
				const endpoints = /* @__PURE__ */ new Set();
				const ids = /* @__PURE__ */ new Set();
				for (const descriptor of descriptors) {
					validateInvocation(descriptor);
					const endpoint = typertEndpoint(descriptor);
					if (endpoints.has(endpoint) || this.entries.has(endpoint)) throw new Error(`typert: ${this.kind} endpoint "${endpoint}" is already registered`);
					if (ids.has(descriptor.id) || this.ids.has(descriptor.id)) throw new Error(`typert: ${this.kind} invocation id "${descriptor.id}" is already registered`);
					endpoints.add(endpoint);
					ids.add(descriptor.id);
				}
			}
			commit(owner, descriptors) {
				for (const descriptor of descriptors) {
					const entry = {
						descriptor,
						owner
					};
					const endpoint = typertEndpoint(descriptor);
					this.entries.set(endpoint, entry);
					this.ids.set(descriptor.id, entry);
					this.history.add(endpoint);
				}
				for (const descriptor of descriptors) this.changes.emit({
					kind: this.kind,
					key: typertEndpoint(descriptor)
				});
			}
			withdraw(owner, descriptors) {
				const removed = [];
				for (const descriptor of descriptors) {
					const endpoint = typertEndpoint(descriptor);
					const entry = this.entries.get(endpoint);
					/* v8 ignore next -- duplicate registration is rejected, so no later owner can replace this entry before its effect disposes. */
					if (entry?.owner !== owner) continue;
					this.entries.delete(endpoint);
					/* v8 ignore next -- ids and endpoints are committed and withdrawn together under the same unique owner. */
					if (this.ids.get(descriptor.id) === entry) this.ids.delete(descriptor.id);
					removed.push(endpoint);
				}
				for (const endpoint of removed) this.changes.emit({
					kind: this.kind,
					key: endpoint
				});
			}
			get(endpoint) {
				return this.entries.get(endpoint)?.descriptor;
			}
			hasSeen(endpoint) {
				return this.history.has(endpoint);
			}
			list() {
				return [...this.entries.values()].map((entry) => entry.descriptor);
			}
			subscribe(ctx, listener) {
				return this.changes.subscribe(ctx, listener);
			}
		};
		var RemoteStore = class {
			descriptors;
			packages = /* @__PURE__ */ new Map();
			constructor(descriptors) {
				this.descriptors = descriptors;
			}
			view(ctx) {
				return {
					register: (contribution) => this.register(ctx, contribution),
					get: (endpoint) => this.descriptors.get(endpoint),
					list: () => this.descriptors.list(),
					subscribe: (listener) => this.descriptors.subscribe(ctx, listener)
				};
			}
			register(ctx, contribution) {
				validateSegment("Remote package name", contribution.package);
				if (this.packages.has(contribution.package)) throw new Error(`typert: Remote package "${contribution.package}" is already registered`);
				this.descriptors.validate(contribution.descriptors);
				const owner = {};
				const { packages, descriptors } = this;
				return ctx.effect(function* () {
					packages.set(contribution.package, owner);
					descriptors.commit(owner, contribution.descriptors);
					yield () => {
						/* v8 ignore else -- duplicate package registration is rejected, so this effect remains the package's unique owner. */
						if (packages.get(contribution.package) === owner) packages.delete(contribution.package);
						descriptors.withdraw(owner, contribution.descriptors);
					};
				}, `typert.remotes.register(${JSON.stringify(contribution.package)})`);
			}
		};
		var LookupStore = class {
			providers = /* @__PURE__ */ new Map();
			resolvers = /* @__PURE__ */ new Map();
			definitions = /* @__PURE__ */ new Map();
			changes;
			constructor(report) {
				this.changes = new ChangeSource(report);
			}
			view(ctx) {
				return {
					register: (key, provider) => this.register(ctx, key, provider),
					configure: (key, resolver) => this.configure(ctx, key, resolver),
					get: (key) => this.get(key),
					definitions: () => [...this.definitions.values()],
					keys: () => [...this.providers.keys()],
					subscribe: (listener) => this.changes.subscribe(ctx, listener)
				};
			}
			get(key) {
				const provider = this.providers.get(key)?.provider;
				if (provider === void 0) return void 0;
				const resolver = this.resolvers.get(key)?.provider;
				if (resolver === void 0) return provider;
				return {
					parameter: provider.parameter,
					wire: provider.wire,
					hostTypeSymbol: provider.hostTypeSymbol,
					wireTypeSymbol: provider.wireTypeSymbol,
					resolve: (id) => resolver.resolve(id)
				};
			}
			configure(ctx, key, resolver) {
				validateSegment("lookup key", key);
				if (this.resolvers.has(key)) throw new Error(`typert: lookup "${key}" resolver is already configured`);
				const entry = {
					provider: { resolve: async (id) => resolver(id) },
					owner: {}
				};
				const { resolvers, changes } = this;
				return ctx.effect(function* () {
					resolvers.set(key, entry);
					changes.emit({
						kind: "lookup",
						key
					});
					yield () => {
						/* v8 ignore next -- duplicate configuration is rejected, so this effect remains the key's unique owner. */
						if (resolvers.get(key) !== entry) return;
						resolvers.delete(key);
						changes.emit({
							kind: "lookup",
							key
						});
					};
				}, `typert.lookups.configure(${JSON.stringify(key)})`);
			}
			register(ctx, key, provider) {
				validateSegment("lookup key", key);
				validateSegment("lookup parameter", provider.parameter);
				validateWireName("lookup wire field", provider.wire);
				validateNonempty("lookup Host type symbol", provider.hostTypeSymbol);
				validateNonempty("lookup wire type symbol", provider.wireTypeSymbol);
				if (this.providers.has(key)) throw new Error(`typert: lookup "${key}" is already registered`);
				const definition = {
					key,
					parameter: provider.parameter,
					wire: provider.wire,
					hostTypeSymbol: provider.hostTypeSymbol,
					wireTypeSymbol: provider.wireTypeSymbol
				};
				const known = this.definitions.get(key);
				if (known !== void 0 && !lookupDefinitionEquals(known, definition)) throw new Error(`typert: lookup "${key}" changed its wire declaration during this registry lifetime`);
				const entry = {
					provider,
					owner: {}
				};
				const { definitions, providers, changes } = this;
				return ctx.effect(function* () {
					definitions.set(key, definition);
					providers.set(key, entry);
					changes.emit({
						kind: "lookup",
						key
					});
					yield () => {
						/* v8 ignore next -- duplicate registration is rejected, so this effect remains the key's unique owner. */
						if (providers.get(key) !== entry) return;
						providers.delete(key);
						changes.emit({
							kind: "lookup",
							key
						});
					};
				}, `typert.lookups.register(${JSON.stringify(key)})`);
			}
		};
		function lookupDefinitionEquals(left, right) {
			return left.parameter === right.parameter && left.wire === right.wire && left.hostTypeSymbol === right.hostTypeSymbol && left.wireTypeSymbol === right.wireTypeSymbol;
		}
		var ContextStore = class {
			hosts = /* @__PURE__ */ new Map();
			hostResolvers = /* @__PURE__ */ new Map();
			clients = /* @__PURE__ */ new Map();
			changes;
			constructor(report) {
				this.changes = new ChangeSource(report);
			}
			view(ctx) {
				return {
					registerHost: (key, adapter) => this.registerHost(ctx, key, adapter),
					configureHost: (key, resolver) => this.configureHost(ctx, key, resolver),
					registerClient: (key, adapter) => this.registerClient(ctx, key, adapter),
					getHost: (key) => this.getHost(key),
					getClient: (key) => this.clients.get(key)?.provider,
					subscribe: (listener) => this.changes.subscribe(ctx, listener)
				};
			}
			getHost(key) {
				const adapter = this.hosts.get(key)?.provider;
				if (adapter === void 0) return void 0;
				const resolver = this.hostResolvers.get(key)?.provider;
				if (resolver === void 0) return adapter;
				return {
					wire: adapter.wire,
					wireTypeSymbol: adapter.wireTypeSymbol,
					resolve: (id) => resolver.resolve(id)
				};
			}
			configureHost(ctx, key, resolver) {
				validateSegment("Context key", key);
				if (this.hostResolvers.has(key)) throw new Error(`typert: host-context "${key}" resolver is already configured`);
				const entry = {
					provider: { resolve: async (id) => resolver(id) },
					owner: {}
				};
				const { hostResolvers, changes } = this;
				return ctx.effect(function* () {
					hostResolvers.set(key, entry);
					changes.emit({
						kind: "host-context",
						key
					});
					yield () => {
						/* v8 ignore next -- duplicate configuration is rejected, so this effect remains the key's unique owner. */
						if (hostResolvers.get(key) !== entry) return;
						hostResolvers.delete(key);
						changes.emit({
							kind: "host-context",
							key
						});
					};
				}, `typert.contexts.configureHost(${JSON.stringify(key)})`);
			}
			registerHost(ctx, key, adapter) {
				validateSegment("Context key", key);
				validateWireName("Context wire field", adapter.wire);
				validateNonempty("Context wire type symbol", adapter.wireTypeSymbol);
				return this.registerProvider(ctx, this.hosts, "host-context", key, adapter);
			}
			registerClient(ctx, key, adapter) {
				validateSegment("Context key", key);
				return this.registerProvider(ctx, this.clients, "client-context", key, adapter);
			}
			registerProvider(ctx, table, kind, key, provider) {
				if (table.has(key)) throw new Error(`typert: ${kind} provider "${key}" is already registered`);
				const entry = {
					provider,
					owner: {}
				};
				const { changes } = this;
				return ctx.effect(function* () {
					table.set(key, entry);
					changes.emit({
						kind,
						key
					});
					yield () => {
						/* v8 ignore next -- duplicate registration is rejected, so this effect remains the key's unique owner. */
						if (table.get(key) !== entry) return;
						table.delete(key);
						changes.emit({
							kind,
							key
						});
					};
				}, `typert.contexts.register(${JSON.stringify(key)})`);
			}
		};
		/**
		* Registry of generated schemas, package reflection, invocations, and Remote
		* dependency providers.
		* @typert service typert
		*/
		var TypertRegistry = class extends _deepseek_ai_cordis.Service {
			schemas = /* @__PURE__ */ new Map();
			packages = /* @__PURE__ */ new Map();
			localStore;
			remoteStore;
			lookupStore;
			contextStore;
			constructor(ctx) {
				super(ctx, "typert");
				const report = (change, error) => {
					ctx.logger.warn(`typert: ${change.kind} observer for "${change.key}" failed`);
					ctx.logger.warn(error);
				};
				this.localStore = new DescriptorStore("local", report);
				this.remoteStore = new RemoteStore(new DescriptorStore("remote", report));
				this.lookupStore = new LookupStore(report);
				this.contextStore = new ContextStore(report);
			}
			/** Current-environment invocation definitions. */
			get local() {
				const ctx = this.ctx;
				return {
					get: (endpoint) => this.localStore.get(endpoint),
					hasSeen: (endpoint) => this.localStore.hasSeen(endpoint),
					list: () => this.localStore.list(),
					subscribe: (listener) => this.localStore.subscribe(ctx, listener)
				};
			}
			/** Consumer-selected Remote definitions. */
			get remotes() {
				return this.remoteStore.view(this.ctx);
			}
			/** Host object lookup providers. */
			get lookups() {
				return this.lookupStore.view(this.ctx);
			}
			/** Host and Client Context adapters. */
			get contexts() {
				return this.contextStore.view(this.ctx);
			}
			/**
			* Register one generated contribution atomically for the calling fiber.
			* Duplicate package-face identities, schemas, invocation ids, or endpoints
			* reject the whole batch.
			* @param contribution - generated schemas, reflection, and Host invocations.
			* @returns the exact effect disposer that removes this contribution.
			*/
			register(contribution) {
				const packageRecord = this.validatePackage(contribution);
				const schemaRecords = this.validateSchemas(contribution);
				const invocations = contribution.invocations;
				this.localStore.validate(invocations);
				const owner = {};
				const { schemas, packages, localStore } = this;
				return this.ctx.effect(function* () {
					packages.set(packageRecord.key, packageRecord);
					for (const record of schemaRecords) schemas.set(record.key, record);
					localStore.commit(owner, invocations);
					yield () => {
						/* v8 ignore else -- duplicate package-face registration is rejected, so this effect remains its unique owner. */
						if (packages.get(packageRecord.key) === packageRecord) packages.delete(packageRecord.key);
						for (const record of schemaRecords)
 /* v8 ignore else -- duplicate schema registration is rejected, so this contribution remains each record's unique owner. */
						if (schemas.get(record.key) === record) schemas.delete(record.key);
						localStore.withdraw(owner, invocations);
					};
				}, "typert.register()");
			}
			/**
			* Look up one schema by `<package>#<name>`.
			* @param key - global schema key.
			* @returns a record containing the cached schema, or `undefined` when absent.
			*/
			get(key) {
				const record = this.schemas.get(key);
				return record === void 0 ? void 0 : materializeSchema(record);
			}
			/**
			* Resolve one required schema.
			* @param key - global schema key.
			* @returns a record containing the cached schema.
			* @throws when the key is malformed, the package face is absent, or the schema is not contributed.
			*/
			resolve(key) {
				const record = this.schemas.get(key);
				if (record !== void 0) return materializeSchema(record);
				const hash = key.indexOf("#");
				if (hash <= 0 || hash === key.length - 1) throw new Error(`typert: invalid schema key "${key}" — expected "<package>#<name>"`);
				const packageName = key.slice(0, hash);
				if ([...this.packages.values()].some((candidate) => candidate.package === packageName)) throw new Error(`typert: cannot resolve "${key}" — package "${packageName}" is registered but contributes no schema named "${key.slice(hash + 1)}"`);
				throw new Error(`typert: cannot resolve "${key}" — package "${packageName}" has no registered contribution`);
			}
			/**
			* Enumerate live schemas in registration order.
			* @param filter - optional package and face restriction.
			* @returns matching records containing the cached schemas.
			*/
			list(filter = {}) {
				return [...this.schemas.values()].filter((record) => matches(record, filter)).map(materializeSchema);
			}
			/**
			* Look up generated reflection for one package face.
			* @param packageName - exact npm package name.
			* @param face - face to query; defaults to the host runtime.
			* @returns the live package record, or `undefined` when absent.
			*/
			getPackage(packageName, face = "host") {
				return this.packages.get(typertPackageKey(packageName, face));
			}
			/**
			* Enumerate generated package reflection in registration order.
			* @param filter - optional package and face restriction.
			* @returns matching package records.
			*/
			listPackages(filter = {}) {
				return [...this.packages.values()].filter((record) => matches(record, filter));
			}
			/**
			* Project a live Zod schema to JSON Schema without caching the result.
			* @param key - global schema key.
			* @param params - Zod projection parameters.
			* @returns a fresh JSON Schema document.
			*/
			toJSONSchema(key, params) {
				return toJSONSchema(this.resolve(key).schema, params);
			}
			validatePackage(contribution) {
				validateSegment("package name", contribution.package);
				const face = contribution.face;
				if (face !== "host" && face !== "client") throw new Error(`typert: invalid face ${JSON.stringify(face)} — expected "host" or "client"`);
				const key = typertPackageKey(contribution.package, contribution.face);
				if (this.packages.has(key)) throw new Error(`typert: package face "${key}" is already registered`);
				return {
					package: contribution.package,
					face,
					key,
					model: contribution.model
				};
			}
			validateSchemas(contribution) {
				const records = [];
				const batch = /* @__PURE__ */ new Set();
				for (const schema of contribution.schemas) {
					validateSegment("schema name", schema.name);
					if (typeof schema.create !== "function") throw new Error(`typert: schema "${schema.name}" has no create() factory`);
					const key = typertKey(contribution.package, schema.name);
					if (batch.has(key) || this.schemas.has(key)) throw new Error(`typert: schema "${key}" is already registered`);
					batch.add(key);
					records.push({
						...schema,
						package: contribution.package,
						face: contribution.face,
						key
					});
				}
				return records;
			}
		};
		function materializeSchema(record) {
			const schema = record.value ??= record.create();
			return {
				name: record.name,
				schema,
				package: record.package,
				face: record.face,
				key: record.key
			};
		}
		function matches(record, filter) {
			return (filter.package === void 0 || record.package === filter.package) && (filter.face === void 0 || record.face === filter.face);
		}
		function validateInvocation(descriptor) {
			validateNonempty("invocation id", descriptor.id);
			validateSegment("invocation service key", descriptor.service);
			validateWireName("invocation namespace", descriptor.namespace);
			validateWireName("invocation method", descriptor.method);
			if (descriptor.implementation !== void 0) validateWireName("invocation implementation method", descriptor.implementation);
			validateCodec(descriptor.result, `${descriptor.id} result`);
			const wires = /* @__PURE__ */ new Set();
			for (const parameter of descriptor.parameters) {
				validateWireName("parameter name", parameter.name);
				validateWireName("parameter wire field", parameter.wire);
				if (wires.has(parameter.wire)) throw new Error(`typert: invocation "${descriptor.id}" repeats wire field "${parameter.wire}"`);
				wires.add(parameter.wire);
				if (parameter.source === "lookup") {
					if (parameter.acceptsUndefined !== void 0) throw new Error(`typert: invocation "${descriptor.id}" lookup parameter "${parameter.name}" cannot accept undefined`);
					if (parameter.lookup === void 0) throw new Error(`typert: invocation "${descriptor.id}" lookup parameter "${parameter.name}" has no lookup key`);
					validateSegment("lookup key", parameter.lookup);
				} else if (parameter.lookup !== void 0) throw new Error(`typert: invocation "${descriptor.id}" JSON parameter "${parameter.name}" declares a lookup key`);
				validateCodec(parameter.codec, `${descriptor.id} parameter ${parameter.name}`);
			}
			const cancellation = descriptor.cancellation;
			if (cancellation !== void 0 && cancellation.parameter !== "signal") throw new Error(`typert: invocation "${descriptor.id}" cancellation parameter must be "signal"`);
			const mode = descriptor.mode;
			if (mode !== void 0 && mode !== "stream") throw new Error(`typert: invocation "${descriptor.id}" mode must be "stream"`);
			if (descriptor.uplink !== void 0) validateCodec(descriptor.uplink.codec, `${descriptor.id} uplink`);
			if (descriptor.scope !== void 0) {
				if (descriptor.invocation.kind !== "direct") throw new Error(`typert: invocation "${descriptor.id}" Context receiver cannot declare a direct scope projection`);
				validateSegment("scope Context key", descriptor.scope.context);
				validateWireName("scope wire field", descriptor.scope.wire);
				const lookups = descriptor.parameters.filter((candidate) => candidate.source === "lookup");
				const parameter = lookups.length === 1 ? lookups[0] : void 0;
				if (parameter === void 0 || parameter.wire !== descriptor.scope.wire || parameter.lookup !== descriptor.scope.context) throw new Error(`typert: invocation "${descriptor.id}" scope wire "${descriptor.scope.wire}" must select its only lookup parameter`);
			}
			if (descriptor.invocation.kind === "context") {
				validateSegment("Context key", descriptor.invocation.context);
				validateWireName("Context wire field", descriptor.invocation.wire);
				if (wires.has(descriptor.invocation.wire)) throw new Error(`typert: invocation "${descriptor.id}" repeats wire field "${descriptor.invocation.wire}"`);
				validateCodec(descriptor.invocation.codec, `${descriptor.id} Context`);
			}
		}
		function validateCodec(codec, subject) {
			if (codec.mode === "src-json") return;
			validateNonempty(`${subject} type symbol`, codec.typeSymbol);
			if (typeof codec.create !== "function") throw new Error(`typert: ${subject} strict codec has no create() factory`);
		}
		function validateWireName(subject, value) {
			if (value === "." || value === ".." || !/^[A-Za-z0-9_$.-]+$/.test(value)) throw new Error(`typert: invalid ${subject} "${value}" — must contain only RPC endpoint segment characters`);
		}
		function validateSegment(subject, value) {
			if (value.length === 0 || value.includes("#")) throw new Error(`typert: invalid ${subject} "${value}" — must be nonempty and must not contain "#"`);
		}
		function validateNonempty(subject, value) {
			if (value.length === 0) throw new Error(`typert: invalid ${subject} — must be nonempty`);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Browser face of the shared Typert runtime registry. */
		/** Required services: none; this is the Client reflection root. */
		const inject = [];
		/**
		* Install the same registry implementation used by the Host face.
		* @param ctx - Client Cordis root.
		*/
		function apply(ctx) {
			new TypertRegistry(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-connection",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region ../../../vendor/cosmokit/lib/index.js
		/** Return true when a value is `null` or `undefined`. */
		function isNullable(value) {
			return value === null || value === void 0;
		}
		/** Return true for non-array object values. */
		function isPlainObject(data) {
			return data && typeof data === "object" && !Array.isArray(data);
		}
		/** Filter object entries and return a new object. */
		function filterKeys(object, filter) {
			return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
		}
		/** Map object values while preserving the original key set. */
		function mapValues(object, transform) {
			return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
		}
		/** Pick selected keys from an object, optionally including `undefined` values. */
		function pick(source, keys, forced) {
			if (!keys) return { ...source };
			const result = {};
			for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
			return result;
		}
		/** Shared config references used by schema validators and plugin runtimes. */
		const write = Symbol.for("cosmokit.volatile.write");
		function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
			if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
			if (value === null || typeof value !== "object") return value;
			if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
			ancestors.add(value);
			try {
				if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
				if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
				return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
			} finally {
				ancestors.delete(value);
			}
		}
		/**
		* Create a detached reference containing an immutable copy of the supplied data.
		* @param value - validated config data; class instances and functions are unsupported.
		* @returns a reference whose value is updated only by its owning runtime.
		*/
		function createVolatile(value) {
			let current = snapshot(value);
			return Object.freeze({
				get: () => current,
				[write]: (value) => {
					current = value;
				}
			});
		}
		/**
		* Identify references across ESM/CJS copies of the shared library.
		* @param value - a parsed config value.
		* @returns whether the value implements the shared reference protocol.
		*/
		function isVolatile(value) {
			return typeof value === "object" && value !== null && write in value;
		}
		/** Test values using `instanceof` with a `toStringTag` fallback. */
		function is(type, value) {
			if (arguments.length === 1) return (value) => is(type, value);
			return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
		}
		function isArrayBufferLike(value) {
			return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
		}
		function isArrayBufferSource(value) {
			return isArrayBufferLike(value) || ArrayBuffer.isView(value);
		}
		/** Binary source detection and base64/hex conversion helpers. */
		var Binary;
		(function(Binary) {
			Binary.is = isArrayBufferLike;
			Binary.isSource = isArrayBufferSource;
			function fromSource(source) {
				if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
				else return source;
			}
			Binary.fromSource = fromSource;
			function toBase64(source) {
				source = fromSource(source);
				if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
				let binary = "";
				const bytes = new Uint8Array(source);
				for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
				return btoa(binary);
			}
			Binary.toBase64 = toBase64;
			function fromBase64(source) {
				if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
				return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
			}
			Binary.fromBase64 = fromBase64;
			function toHex(source) {
				source = fromSource(source);
				if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
				return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
			}
			Binary.toHex = toHex;
			function fromHex(source) {
				if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
				const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
				const buffer = [];
				for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
				return Uint8Array.from(buffer).buffer;
			}
			Binary.fromHex = fromHex;
		})(Binary || (Binary = {}));
		Binary.fromBase64;
		Binary.toBase64;
		Binary.fromHex;
		Binary.toHex;
		/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
		function clone(source, refs = /* @__PURE__ */ new Map()) {
			if (!source || typeof source !== "object") return source;
			if (is("Date", source)) return new Date(source.valueOf());
			if (is("RegExp", source)) return new RegExp(source.source, source.flags);
			if (isArrayBufferLike(source)) return source.slice(0);
			if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
			const cached = refs.get(source);
			if (cached) return cached;
			if (Array.isArray(source)) {
				const result = [];
				refs.set(source, result);
				source.forEach((value, index) => {
					result[index] = Reflect.apply(clone, null, [value, refs]);
				});
				return result;
			}
			const result = Object.create(Object.getPrototypeOf(source));
			refs.set(source, result);
			for (const key of Reflect.ownKeys(source)) {
				const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
				if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
				Reflect.defineProperty(result, key, descriptor);
			}
			return result;
		}
		/**
		* Compare values recursively, treating two volatile references as equal regardless of value.
		* Strict comparison distinguishes null/undefined, treats opaque objects by identity,
		* compares URLs by normalized href, treats array holes as undefined, and considers distinct cyclic structures unequal.
		* @param a - first value.
		* @param b - second value.
		* @param strict - whether to require strict data equality outside volatile references.
		* @returns whether the values compare equal.
		*/
		function deepEqual(a, b, strict) {
			const ancestors = /* @__PURE__ */ new Set();
			function compare(a, b) {
				if (a === b) return true;
				if (isVolatile(a) || isVolatile(b)) return isVolatile(a) && isVolatile(b);
				if (!strict && isNullable(a) && isNullable(b)) return true;
				if (typeof a !== typeof b || typeof a !== "object" || !a || !b) return false;
				if (ancestors.has(a)) return false;
				function check(test, then) {
					return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
				}
				ancestors.add(a);
				try {
					return check(Array.isArray, (a, b) => {
						if (a.length !== b.length) return false;
						for (let index = 0; index < a.length; index++) if (!compare(a[index], b[index])) return false;
						return true;
					}) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("URL"), (a, b) => a.href === b.href) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
						if (a.byteLength !== b.byteLength) return false;
						const viewA = new Uint8Array(a);
						const viewB = new Uint8Array(b);
						for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
						return true;
					}) ?? ((!strict || [a, b].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
						...a,
						...b
					}).every((key) => compare(a[key], b[key])));
				} finally {
					ancestors.delete(a);
				}
			}
			return compare(a, b);
		}
		/** Time constants plus parsing and formatting helpers. */
		var Time;
		(function(Time) {
			Time.millisecond = 1;
			Time.second = 1e3;
			Time.minute = Time.second * 60;
			Time.hour = Time.minute * 60;
			Time.day = Time.hour * 24;
			Time.week = Time.day * 7;
			let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
			function setTimezoneOffset(offset) {
				timezoneOffset = offset;
			}
			Time.setTimezoneOffset = setTimezoneOffset;
			function getTimezoneOffset() {
				return timezoneOffset;
			}
			Time.getTimezoneOffset = getTimezoneOffset;
			function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
				if (typeof date === "number") date = new Date(date);
				if (offset === void 0) offset = timezoneOffset;
				return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
			}
			Time.getDateNumber = getDateNumber;
			function fromDateNumber(value, offset) {
				const date = new Date(value * Time.day);
				if (offset === void 0) offset = timezoneOffset;
				return new Date(+date + offset * Time.minute);
			}
			Time.fromDateNumber = fromDateNumber;
			const numeric = /\d+(?:\.\d+)?/.source;
			const timeRegExp = new RegExp(`^${[
				"w(?:eek(?:s)?)?",
				"d(?:ay(?:s)?)?",
				"h(?:our(?:s)?)?",
				"m(?:in(?:ute)?(?:s)?)?",
				"s(?:ec(?:ond)?(?:s)?)?"
			].map((unit) => `(${numeric}${unit})?`).join("")}$`);
			function parseTime(source) {
				const capture = timeRegExp.exec(source);
				if (!capture) return 0;
				return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
			}
			Time.parseTime = parseTime;
			function parseDate(date) {
				const parsed = parseTime(date);
				if (parsed) date = Date.now() + parsed;
				else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
				else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
				return date ? new Date(date) : /* @__PURE__ */ new Date();
			}
			Time.parseDate = parseDate;
			function format(ms) {
				const abs = Math.abs(ms);
				if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
				else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
				else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
				else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
				return ms + "ms";
			}
			Time.format = format;
			function toDigits(source, length = 2) {
				return source.toString().padStart(length, "0");
			}
			Time.toDigits = toDigits;
			function template(template, time = /* @__PURE__ */ new Date()) {
				return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
			}
			Time.template = template;
		})(Time || (Time = {}));
		//#endregion
		//#region ../../../vendor/schemastery/lib/index.mjs
		const kSchema = Symbol.for("schemastery");
		const kValidationError = Symbol.for("ValidationError");
		globalThis.__schemastery_index__ ??= 0;
		globalThis.__schemastery_refs__ = void 0;
		var ValidationError = class extends TypeError {
			options;
			name = "ValidationError";
			constructor(message, options) {
				let prefix = "$";
				for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
				else if (typeof segment === "number") prefix += "[" + segment + "]";
				else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
				if (prefix.startsWith(".")) prefix = prefix.slice(1);
				super((prefix === "$" ? "" : `${prefix} `) + message);
				this.options = options;
			}
			static is(error) {
				return !!error?.[kValidationError];
			}
		};
		Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
		const Schema = function(options) {
			const schema = function(data, options = {}) {
				return Schema.resolve(data, schema, options)[0];
			};
			if (options.refs) {
				const refs = mapValues(options.refs, (options) => new Schema(options));
				const getRef = (uid) => refs[uid];
				for (const key in refs) {
					const options = refs[key];
					options.sKey = getRef(options.sKey);
					options.inner = getRef(options.inner);
					options.list = options.list && options.list.map(getRef);
					options.dict = options.dict && mapValues(options.dict, getRef);
				}
				return refs[options.uid];
			}
			Object.assign(schema, options);
			if (typeof schema.callback === "string") try {
				schema.callback = new Function("return " + schema.callback)();
			} catch {}
			Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
			Object.setPrototypeOf(schema, Schema.prototype);
			schema.meta ||= {};
			schema.toString = schema.toString.bind(schema);
			return schema;
		};
		Schema.prototype = Object.create(Function.prototype);
		Schema.prototype[kSchema] = true;
		Object.defineProperty(Schema.prototype, "~standard", { get() {
			return {
				version: 1,
				vendor: "schemastery",
				validate: (value) => {
					try {
						return { value: Schema.resolve(value, this, {})[0] };
					} catch (error) {
						if (ValidationError.is(error)) return { issues: [{
							message: error.message,
							path: error.options.path
						}] };
						throw error;
					}
				}
			};
		} });
		Schema.ValidationError = ValidationError;
		Schema.prototype.toJSON = function toJSON() {
			if (globalThis.__schemastery_refs__) {
				globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
				return this.uid;
			}
			globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
			globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
			const result = {
				uid: this.uid,
				refs: globalThis.__schemastery_refs__
			};
			globalThis.__schemastery_refs__ = void 0;
			return result;
		};
		Schema.prototype.set = function set(key, value) {
			this.dict[key] = value;
			return this;
		};
		Schema.prototype.push = function push(value) {
			this.list.push(value);
			return this;
		};
		function mergeDesc(original, messages) {
			const result = typeof original === "string" ? { "": original } : { ...original };
			for (const locale in messages) {
				const value = messages[locale];
				if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
				else if (typeof value === "string") result[locale] = value;
			}
			return result;
		}
		function getInner(value) {
			return value?.$value ?? value?.$inner;
		}
		function extractKeys(data) {
			return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
		}
		Schema.prototype.i18n = function i18n(messages) {
			const schema = Schema(this);
			const desc = mergeDesc(schema.meta.description, messages);
			if (Object.keys(desc).length) schema.meta.description = desc;
			if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
				return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
			});
			if (schema.list) schema.list = schema.list.map((inner, index) => {
				return inner.i18n(mapValues(messages, (data = {}) => {
					if (Array.isArray(getInner(data))) return getInner(data)[index];
					if (Array.isArray(data)) return data[index];
					return extractKeys(data);
				}));
			});
			if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
				if (getInner(data)) return getInner(data);
				return extractKeys(data);
			}));
			if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
			return schema;
		};
		Schema.prototype.extra = function extra(key, value) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		};
		for (const key of [
			"required",
			"disabled",
			"collapse",
			"hidden",
			"loose"
		]) Object.assign(Schema.prototype, { [key](value = true) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		} });
		Schema.prototype.deprecated = function deprecated() {
			const schema = Schema(this);
			schema.meta.badges ||= [];
			schema.meta.badges.push({
				text: "deprecated",
				type: "danger"
			});
			return schema;
		};
		Schema.prototype.experimental = function experimental() {
			const schema = Schema(this);
			schema.meta.badges ||= [];
			schema.meta.badges.push({
				text: "experimental",
				type: "warning"
			});
			return schema;
		};
		Schema.prototype.pattern = function pattern(regexp) {
			const schema = Schema(this);
			const pattern = pick(regexp, ["source", "flags"]);
			schema.meta = {
				...schema.meta,
				pattern
			};
			return schema;
		};
		Schema.prototype.simplify = function simplify(value) {
			if (isVolatile(value)) value = value.get();
			if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
			if (isNullable(value)) return value;
			if (this.type === "object" || this.type === "dict") {
				const result = {};
				for (const key in value) {
					const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
					if (this.type === "dict" || !isNullable(item)) result[key] = item;
				}
				if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
				return result;
			} else if (this.type === "array" || this.type === "tuple") {
				const result = [];
				value.forEach((value, index) => {
					const schema = this.type === "array" ? this.inner : this.list[index];
					const item = schema ? schema.simplify(value) : value;
					result.push(item);
				});
				return result;
			} else if (this.type === "intersect") {
				const result = {};
				for (const item of this.list) Object.assign(result, item.simplify(value));
				return result;
			} else if (this.type === "union") for (const schema of this.list) try {
				Schema.resolve(value, schema, {});
				return schema.simplify(value);
			} catch {}
			return value;
		};
		Schema.prototype.toString = function toString(inline) {
			return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
		};
		Schema.prototype.role = function role(role, extra) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				role,
				extra
			};
			return schema;
		};
		for (const key of [
			"default",
			"link",
			"comment",
			"description",
			"max",
			"min",
			"step"
		]) Object.assign(Schema.prototype, { [key](value) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		} });
		Schema.prototype.volatile = function volatile() {
			if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
			return this.extra("volatile", true);
		};
		const resolvers = {};
		const checkedVolatile = Symbol("checked-volatile-schema");
		function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
			const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
			if (states.has(blocked)) return;
			states.add(blocked);
			seen.set(schema, states);
			if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
			const nested = blocked || !!schema.meta?.volatile;
			if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
			if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
			if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
			if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
		}
		Schema.extend = function extend(type, resolve) {
			resolvers[type] = resolve;
		};
		Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
			if (!schema) return [data];
			if (!options[checkedVolatile]) {
				validateVolatileSchema(schema, options.path);
				options = {
					...options,
					[checkedVolatile]: true
				};
			}
			if (schema.meta?.volatile) {
				const inner = Schema(schema);
				inner.meta = {
					...schema.meta,
					volatile: false
				};
				const [value, adapted] = Schema.resolve(data, inner, options, strict);
				try {
					return [createVolatile(value), adapted];
				} catch (error) {
					throw new ValidationError(error instanceof Error ? error.message : String(error), options);
				}
			}
			if (options.ignore?.(data, schema)) return [data];
			if (isNullable(data) && schema.type !== "lazy") {
				if (schema.meta.required) throw new ValidationError(`missing required value`, options);
				let current = schema;
				let fallback = schema.meta.default;
				while (current?.type === "intersect" && isNullable(fallback)) {
					current = current.list[0];
					fallback = current?.meta.default;
				}
				if (isNullable(fallback)) return [data];
				data = clone(fallback);
			}
			const callback = resolvers[schema.type];
			if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
			try {
				return callback(data, schema, options, strict);
			} catch (error) {
				if (!schema.meta.loose) throw error;
				return [schema.meta.default];
			}
		};
		Schema.from = function from(source) {
			if (isNullable(source)) return Schema.any();
			else if ([
				"string",
				"number",
				"boolean"
			].includes(typeof source)) return Schema.const(source).required();
			else if (source[kSchema]) return source;
			else if (typeof source === "function") switch (source) {
				case String: return Schema.string().required();
				case Number: return Schema.number().required();
				case Boolean: return Schema.boolean().required();
				case Function: return Schema.function().required();
				default: return Schema.is(source).required();
			}
			else throw new TypeError(`cannot infer schema from ${source}`);
		};
		Schema.lazy = function lazy(builder) {
			const toJSON = () => {
				if (!schema.inner[kSchema]) {
					schema.inner = schema.builder();
					schema.inner.meta = {
						...schema.meta,
						...schema.inner.meta
					};
				}
				return schema.inner.toJSON();
			};
			const schema = new Schema({
				type: "lazy",
				builder,
				inner: { toJSON }
			});
			return schema;
		};
		Schema.natural = function natural() {
			return Schema.number().step(1).min(0);
		};
		Schema.percent = function percent() {
			return Schema.number().step(.01).min(0).max(1).role("slider");
		};
		Schema.date = function date() {
			return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
				const date = new Date(value);
				if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
				return date;
			}, true)]);
		};
		Schema.regExp = function regExp(flag = "") {
			return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
				try {
					return new RegExp(value, flag);
				} catch (e) {
					throw new ValidationError(e.message, options);
				}
			}, true)]);
		};
		Schema.arrayBuffer = function arrayBuffer(encoding) {
			return Schema.union([
				Schema.is(ArrayBuffer),
				Schema.is(SharedArrayBuffer),
				Schema.transform(Schema.any(), (value, options) => {
					if (Binary.isSource(value)) return Binary.fromSource(value);
					throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
				}, true),
				...encoding ? [Schema.transform(Schema.string(), (value, options) => {
					try {
						return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
					} catch (e) {
						throw new ValidationError(e.message, options);
					}
				}, true)] : []
			]);
		};
		Schema.extend("lazy", (data, schema, options, strict) => {
			if (!schema.inner[kSchema]) {
				schema.inner = schema.builder();
				schema.inner.meta = {
					...schema.meta,
					...schema.inner.meta
				};
				validateVolatileSchema(schema.inner, options.path, true);
			}
			return Schema.resolve(data, schema.inner, options, strict);
		});
		Schema.extend("any", (data) => {
			return [data];
		});
		Schema.extend("never", (data, _, options) => {
			throw new ValidationError(`expected nullable but got ${data}`, options);
		});
		Schema.extend("const", (data, { value }, options) => {
			if (deepEqual(data, value)) return [value];
			throw new ValidationError(`expected ${value} but got ${data}`, options);
		});
		function checkWithinRange(data, meta, description, options, skipMin = false) {
			const { max = Infinity, min = -Infinity } = meta;
			if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
			if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
		}
		Schema.extend("string", (data, { meta }, options) => {
			if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
			if (meta.pattern) {
				const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
				if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
			}
			checkWithinRange(data.length, meta, "string length", options);
			return [data];
		});
		function decimalShift(data, digits) {
			const str = data.toString();
			if (str.includes("e")) return data * Math.pow(10, digits);
			const index = str.indexOf(".");
			if (index === -1) return data * Math.pow(10, digits);
			const frac = str.slice(index + 1);
			const integer = str.slice(0, index);
			if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
			return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
		}
		function isMultipleOf(data, min, step) {
			step = Math.abs(step);
			if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
			const index = step.toString().indexOf(".");
			const digits = step.toString().slice(index + 1).length;
			return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
		}
		Schema.extend("number", (data, { meta }, options) => {
			if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
			checkWithinRange(data, meta, "number", options);
			const { step } = meta;
			if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
			return [data];
		});
		Schema.extend("boolean", (data, _, options) => {
			if (typeof data === "boolean") return [data];
			throw new ValidationError(`expected boolean but got ${data}`, options);
		});
		Schema.extend("bitset", (data, { bits, meta }, options) => {
			let value = 0, keys = [];
			if (typeof data === "number") {
				value = data;
				for (const key in bits) if (data & bits[key]) keys.push(key);
			} else if (Array.isArray(data)) {
				keys = data;
				for (const key of keys) {
					if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
					if (key in bits) value |= bits[key];
				}
			} else throw new ValidationError(`expected number or array but got ${data}`, options);
			if (value === meta.default) return [value];
			return [value, keys];
		});
		Schema.extend("function", (data, _, options) => {
			if (typeof data === "function") return [data];
			throw new ValidationError(`expected function but got ${data}`, options);
		});
		Schema.extend("is", (data, { constructor }, options) => {
			if (typeof constructor === "function") {
				if (data instanceof constructor) return [data];
				throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
			} else {
				if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
				let prototype = Object.getPrototypeOf(data);
				while (prototype) {
					if (prototype.constructor?.name === constructor) return [data];
					prototype = Object.getPrototypeOf(prototype);
				}
				throw new ValidationError(`expected ${constructor} but got ${data}`, options);
			}
		});
		function property(data, key, schema, options) {
			try {
				const [value, adapted] = Schema.resolve(data[key], schema, {
					...options,
					path: [...options.path || [], key]
				});
				if (adapted !== void 0) data[key] = adapted;
				return value;
			} catch (e) {
				if (!options?.autofix) throw e;
				delete data[key];
				return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
			}
		}
		Schema.extend("array", (data, { inner, meta }, options) => {
			if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
			checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
			return [data.map((_, index) => property(data, index, inner, options))];
		});
		Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
			if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
			const result = {};
			for (const key in data) {
				let rKey;
				try {
					rKey = Schema.resolve(key, sKey, options)[0];
				} catch (error) {
					if (strict) continue;
					throw error;
				}
				result[rKey] = property(data, key, inner, options);
				data[rKey] = data[key];
				if (key !== rKey) delete data[key];
			}
			return [result];
		});
		Schema.extend("tuple", (data, { list }, options, strict) => {
			if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
			const result = list.map((inner, index) => property(data, index, inner, options));
			if (strict) return [result];
			result.push(...data.slice(list.length));
			return [result];
		});
		function merge(result, data) {
			for (const key in data) {
				if (key in result) continue;
				result[key] = data[key];
			}
		}
		Schema.extend("object", (data, { dict }, options, strict) => {
			if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
			const result = {};
			for (const key in dict) {
				const value = property(data, key, dict[key], options);
				if (!isNullable(value) || key in data) result[key] = value;
			}
			if (!strict) merge(result, data);
			return [result];
		});
		Schema.extend("union", (data, { list, toString }, options, strict) => {
			const messages = [];
			for (const inner of list) try {
				return Schema.resolve(data, inner, options, strict);
			} catch (error) {
				messages.push(error);
			}
			throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		});
		Schema.extend("intersect", (data, { list, toString }, options, strict) => {
			if (!list.length) return [data];
			let result;
			for (const inner of list) {
				const value = Schema.resolve(data, inner, options, true)[0];
				if (isNullable(value)) continue;
				if (isNullable(result)) result = value;
				else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
				else if (typeof value === "object") merge(result ??= {}, value);
				else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
			}
			if (!strict && isPlainObject(data)) merge(result, data);
			return [result];
		});
		Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
			const [result, adapted = data] = Schema.resolve(data, inner, options, true);
			if (preserve) return [callback(result)];
			else return [callback(result), callback(adapted)];
		});
		const formatters = {};
		function defineMethod(name, keys, format) {
			formatters[name] = format;
			Object.assign(Schema, { [name](...args) {
				const schema = new Schema({ type: name });
				keys.forEach((key, index) => {
					switch (key) {
						case "sKey":
							schema.sKey = args[index] ?? Schema.string();
							break;
						case "inner":
							schema.inner = Schema.from(args[index]);
							break;
						case "list":
							schema.list = args[index].map(Schema.from);
							break;
						case "dict":
							schema.dict = mapValues(args[index], Schema.from);
							break;
						case "bits":
							schema.bits = {};
							for (const key in args[index]) {
								if (typeof args[index][key] !== "number") continue;
								schema.bits[key] = args[index][key];
							}
							break;
						case "callback": {
							const callback = schema.callback = args[index];
							callback["toJSON"] ||= () => callback.toString();
							break;
						}
						case "constructor": {
							const constructor = schema.constructor = args[index];
							if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
							break;
						}
						default: schema[key] = args[index];
					}
				});
				if (name === "object" || name === "dict") schema.meta.default = {};
				else if (name === "array" || name === "tuple") schema.meta.default = [];
				else if (name === "bitset") schema.meta.default = 0;
				return schema;
			} });
		}
		defineMethod("is", ["constructor"], ({ constructor }) => {
			if (typeof constructor === "function") return constructor.name;
			else return constructor;
		});
		defineMethod("any", [], () => "any");
		defineMethod("never", [], () => "never");
		defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
		defineMethod("string", [], () => "string");
		defineMethod("number", [], () => "number");
		defineMethod("boolean", [], () => "boolean");
		defineMethod("bitset", ["bits"], () => "bitset");
		defineMethod("function", [], () => "function");
		defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
		defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
		defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
		defineMethod("object", ["dict"], ({ dict }) => {
			if (Object.keys(dict).length === 0) return "{}";
			return `{ ${Object.entries(dict).map(([key, inner]) => {
				return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
			}).join(", ")} }`;
		});
		defineMethod("union", ["list"], ({ list }, inline) => {
			const result = list.map(({ toString: format }) => format()).join(" | ");
			return inline ? `(${result})` : result;
		});
		defineMethod("intersect", ["list"], ({ list }) => {
			return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
		});
		defineMethod("transform", [
			"inner",
			"callback",
			"preserve"
		], ({ inner }, isInner) => inner.toString(isInner));
		//#endregion
		//#region lib/types/recovery-config.js
		/** Shared validation for Host-configured and browser-local connection recovery. */
		const MAX_TIMER_MS = 2147483647;
		/** Schema shared by the Host plugin and the Client's recovery input parser. */
		const ConnectionRecoveryConfigSchema = Schema.object({
			backoffBaseMs: Schema.natural().min(1).max(MAX_TIMER_MS).default(500),
			backoffFactor: Schema.number().min(1).max(Number.MAX_VALUE).default(2),
			backoffMaxMs: Schema.natural().min(1).max(MAX_TIMER_MS).default(1e4),
			generationReadyWarnMs: Schema.natural().min(1).max(MAX_TIMER_MS).default(3e3),
			generationReadyTimeoutMs: Schema.natural().min(1).max(MAX_TIMER_MS).default(15e3)
		});
		/**
		* Validate recovery input and supply every timing default before starting work.
		* @param config - Host configuration, page bootstrap data, or direct loop options.
		* @returns validated, complete recovery timing.
		*/
		function resolveConnectionConfig(config = {}) {
			const resolved = ConnectionRecoveryConfigSchema(config);
			if (!Number.isFinite(resolved.backoffFactor)) throw new RangeError("connection recovery backoffFactor must be finite");
			return resolved;
		}
		//#endregion
		//#region lib/types/client/connection.js
		/** Connection generation readiness, cancellation, and continuous recovery. */
		const MANUAL_RECONNECT = /* @__PURE__ */ new Error("connection: manual reconnect requested");
		const NETWORK_STATE_CHANGED = /* @__PURE__ */ new Error("connection: browser network state changed");
		function sleep(ms, signal) {
			return new Promise((resolve) => {
				const t = setTimeout(done, ms);
				signal.addEventListener("abort", done, { once: true });
				function done() {
					clearTimeout(t);
					signal.removeEventListener("abort", done);
					resolve();
				}
			});
		}
		function waitForAbort(signal) {
			if (signal.aborted) return Promise.resolve();
			return new Promise((resolve) => {
				signal.addEventListener("abort", () => {
					resolve();
				}, { once: true });
			});
		}
		/**
		* Opens the registered generation source, reconnecting with exponential backoff on loss.
		* State (generation/attempt) is instance-private, never in the store.
		* Sink exceptions do not kill the generation loop.
		*/
		var ConnectionController = class {
			source;
			sinks;
			generation = 0;
			attempt = 0;
			current = null;
			retryDelay = null;
			running = false;
			immediateRetry = false;
			networkAvailable = true;
			lastState;
			config;
			constructor(source, sinks = {}, config = {}) {
				this.source = source;
				this.sinks = sinks;
				this.config = resolveConnectionConfig(config);
			}
			/** Idempotent: begin the connect/pump/reconnect loop. */
			start() {
				if (this.running) return;
				this.running = true;
				this.loop();
			}
			/** Stop the loop and abort the current generation source. */
			stop() {
				this.running = false;
				this.current?.abort();
				this.current = null;
				this.retryDelay?.abort();
				this.retryDelay = null;
			}
			/** Reset the retry sequence and replace the current generation or retry delay immediately. */
			reconnect() {
				if (!this.running) return;
				this.attempt = 0;
				this.immediateRetry = true;
				this.emitState("connecting");
				if (!this.isRunning()) return;
				this.current?.abort(MANUAL_RECONNECT);
				this.retryDelay?.abort(MANUAL_RECONNECT);
			}
			/**
			* Suspend automatic retries while offline and restart backoff when the network returns.
			* @param available - whether the browser reports network access.
			*/
			setNetworkAvailable(available) {
				if (this.networkAvailable === available) return;
				this.networkAvailable = available;
				this.attempt = 0;
				this.immediateRetry = false;
				if (!this.running) return;
				this.emitState(available ? "connecting" : "disconnected");
				if (!this.isRunning()) return;
				this.current?.abort(NETWORK_STATE_CHANGED);
				this.retryDelay?.abort(NETWORK_STATE_CHANGED);
			}
			backoffCap(attempt) {
				const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config;
				return Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1));
			}
			backoffDelay(attempt) {
				const cap = this.backoffCap(attempt);
				return cap / 2 + Math.random() * (cap / 2);
			}
			/** Re-read retry inputs after a potentially reentrant state sink. */
			isRetryInterrupted(immediate) {
				return this.immediateRetry || !this.networkAvailable && !immediate;
			}
			/** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
			isRunning() {
				return this.running;
			}
			/** Re-read both mutable liveness guards after a potentially reentrant sink. */
			isGenerationActive(controller) {
				return this.isRunning() && !controller.signal.aborted;
			}
			async loop() {
				let retry = false;
				while (this.running) {
					if (!this.networkAvailable && !this.immediateRetry) {
						const retryDelay = new AbortController();
						this.retryDelay = retryDelay;
						this.emitState("disconnected");
						await waitForAbort(retryDelay.signal);
						if (this.retryDelay === retryDelay) this.retryDelay = null;
						if (!this.isRunning()) return;
						retry = true;
						continue;
					}
					let manualAttempt = false;
					if (retry) {
						const immediate = this.immediateRetry;
						this.immediateRetry = false;
						if (immediate) this.attempt = 0;
						manualAttempt = immediate;
						const attempt = ++this.attempt;
						this.emitState("connecting");
						if (!this.isRunning()) return;
						if (this.isRetryInterrupted(immediate)) continue;
						if (!immediate) {
							const retryDelay = new AbortController();
							this.retryDelay = retryDelay;
							await sleep(this.backoffDelay(attempt), retryDelay.signal);
							if (this.retryDelay === retryDelay) this.retryDelay = null;
							if (!this.isRunning()) return;
							if (retryDelay.signal.aborted) continue;
						}
						console.warn(`[connection] connection lost, retry #${String(attempt)}`);
						this.callSink(() => {
							this.sinks.onReconnectRequested?.();
						});
						if (!this.isRunning()) return;
					}
					const gen = ++this.generation;
					const ac = new AbortController();
					this.current = ac;
					let sourceReady = false;
					let resolveReady;
					let rejectReady;
					let rejectSourceLost;
					const ready = new Promise((resolve, reject) => {
						resolveReady = resolve;
						rejectReady = reject;
					});
					const sourceLost = new Promise((_resolve, reject) => {
						rejectSourceLost = reject;
					});
					const reportReady = (host) => {
						if (sourceReady || gen !== this.generation || !this.isGenerationActive(ac)) return;
						sourceReady = true;
						resolveReady(host);
					};
					const failed = new Promise((resolve) => {
						const settle = () => {
							if (gen === this.generation && !ac.signal.aborted) ac.abort();
							resolve();
						};
						Promise.resolve().then(() => this.source(ac.signal, reportReady)).then(() => {
							const error = /* @__PURE__ */ new Error("connection generation ended");
							if (!sourceReady) rejectReady(error);
							rejectSourceLost(error);
							settle();
						}, (error) => {
							const failure = error instanceof Error ? error : new Error("connection generation failed", { cause: error });
							if (!sourceReady) rejectReady(failure);
							rejectSourceLost(failure);
							settle();
						});
					});
					try {
						const host = await Promise.race([waitForReady(ready, this.config, ac.signal), sourceLost]);
						if (ac.signal.aborted) throw new Error("generation aborted during readiness handshake");
						this.attempt = 0;
						this.emitState("connected");
						if (this.isGenerationActive(ac)) this.callSink(() => {
							this.sinks.onConnected?.(host);
						});
					} catch (error) {
						if (!ac.signal.aborted) ac.abort(error);
					}
					await failed;
					if (!this.isRunning()) return;
					if (manualAttempt) this.attempt = 0;
					retry = true;
				}
			}
			/** Deduplicated state emission (sink isolation applies). */
			emitState(state) {
				if (this.lastState === state) return;
				this.lastState = state;
				this.callSink(() => this.sinks.onStateChange?.(state));
			}
			/** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
			callSink(fn) {
				try {
					fn();
				} catch (error) {
					console.error("[connection] connection sink threw:", error);
				}
			}
		};
		/** Report a slow handshake before the hard deadline ends its generation. */
		function waitForReady(ready, config, signal) {
			return new Promise((resolve, reject) => {
				let settled = false;
				const warning = setTimeout(() => {
					console.warn(`[connection] generation is still not ready after ${String(config.generationReadyWarnMs)}ms`);
				}, config.generationReadyWarnMs);
				const timeout = setTimeout(() => {
					const error = /* @__PURE__ */ new Error(`connection generation was not ready within ${String(config.generationReadyTimeoutMs)}ms`);
					console.warn(`[connection] ${error.message}; cancelling generation`);
					finish({ error });
				}, config.generationReadyTimeoutMs);
				const aborted = () => {
					finish({ error: new Error("connection generation aborted", { cause: signal.reason }) });
				};
				const finish = (outcome) => {
					if (settled) return;
					settled = true;
					clearTimeout(warning);
					clearTimeout(timeout);
					signal.removeEventListener("abort", aborted);
					if ("error" in outcome) reject(outcome.error);
					else resolve(outcome.value);
				};
				signal.addEventListener("abort", aborted, { once: true });
				ready.then((value) => {
					finish({ value });
				}, (error) => {
					finish({ error });
				});
			});
		}
		//#endregion
		//#region lib/types/rpc.js
		/** Generic unary RPC contracts shared by the Host and Client Connection halves. */
		/**
		* Brand one validated string as a Connection correlation id.
		* @param id - validated wire identity.
		* @returns the same string with the correlation-id brand.
		*/
		function RpcId(id) {
			return id;
		}
		/**
		* Convert a rejected transport operation into a generic failure result.
		* @param error - rejected transport value.
		* @returns an `internal` failure preserving the available message.
		*/
		function transportError(error) {
			return {
				ok: false,
				error: {
					code: "gateway/internal",
					message: error instanceof Error ? error.message : String(error),
					details: {}
				}
			};
		}
		//#endregion
		//#region lib/types/client/random-uuid.js
		/** Browser-safe UUID generation for client-side wire correlation. */
		/**
		* Generate an RFC 4122 version 4 UUID without requiring a secure context.
		* @returns a UUID backed by `crypto.getRandomValues()`, which browsers expose on insecure origins.
		*/
		function randomUuid() {
			const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			view.setUint8(6, view.getUint8(6) & 15 | 64);
			view.setUint8(8, view.getUint8(8) & 63 | 128);
			const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
		//#endregion
		//#region lib/types/client/rpc.js
		/** Browser caller for generic Connection unary RPC channels. */
		const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/;
		const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
		/**
		* Create the browser-backed generic RPC caller.
		* @param doFetch - transport override; defaults to the page's global fetch.
		* @param openStream - optional worker-local Gateway stream carrier.
		* @returns caller that owns request correlation and response-envelope validation.
		*/
		function createWebConnectionRpc(doFetch, openStream) {
			const send = doFetch ?? ((input, init) => globalThis.fetch(input, init));
			return {
				async call(channel, endpoint, payload, signal) {
					assertTarget(channel, endpoint);
					const rpcId = RpcId(randomUuid());
					const message = {
						type: "client-request",
						rpcId,
						method: endpoint,
						payload
					};
					const response = await send(`${channel}/${endpoint}`.slice(1), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(message),
						...signal === void 0 ? {} : { signal }
					});
					if (!response.ok) throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`);
					const full = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "multipart/form-data" ? await parseBinaryResponse(response) : parseConnectionResponse(await response.json());
					signal?.throwIfAborted();
					if (full.rpcId !== rpcId) throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`);
					return full.result;
				},
				...openStream === void 0 ? {} : { open(channel, endpoint, payload, signal, uplink) {
					assertTarget(channel, endpoint);
					if (channel !== "/api") throw new Error(`connection: worker-local streams require the /api channel, got ${JSON.stringify(channel)}`);
					return openStream(endpoint, payload, signal, uplink);
				} }
			};
		}
		async function parseBinaryResponse(response) {
			const body = await response.formData();
			const fields = /* @__PURE__ */ new Map();
			for (const [name, value] of body) {
				if (fields.has(name)) throw new TypeError("connection: invalid binary response fields");
				fields.set(name, value);
			}
			const metadata = fields.get("metadata");
			fields.delete("metadata");
			if (typeof metadata !== "string") throw new TypeError("connection: invalid binary response fields");
			const envelope = JSON.parse(metadata);
			const full = parseConnectionResponse(envelope);
			if (!full.result.ok || !isRecord(envelope) || !Array.isArray(envelope.attachments) || envelope.attachments.length === 0) throw new TypeError("connection: invalid binary response result");
			const root = { value: full.result.value };
			for (const attachment of envelope.attachments) {
				if (!isRecord(attachment) || attachment.codec !== "bytes" || typeof attachment.part !== "string" || !Array.isArray(attachment.path)) throw new TypeError("connection: invalid binary response attachment");
				const data = fields.get(attachment.part);
				fields.delete(attachment.part);
				if (!(data instanceof Blob)) throw new TypeError("connection: invalid binary response fields");
				let parent = root;
				let key = "value";
				for (const segment of attachment.path) {
					const value = Reflect.get(parent, key);
					if (typeof value !== "object" || value === null) throw new TypeError("connection: invalid binary response path");
					if (Array.isArray(value)) {
						if (typeof segment !== "number" || !Number.isSafeInteger(segment) || segment < 0 || segment >= value.length) throw new TypeError("connection: invalid binary response path");
					} else if (typeof segment !== "string") throw new TypeError("connection: invalid binary response path");
					if (!Object.hasOwn(value, segment)) throw new TypeError("connection: invalid binary response path");
					parent = value;
					key = segment;
				}
				if (Reflect.get(parent, key) !== null) throw new TypeError("connection: invalid binary response placeholder");
				Object.defineProperty(parent, key, {
					value: new Uint8Array(await data.arrayBuffer()),
					enumerable: true,
					writable: true,
					configurable: true
				});
			}
			if (fields.size !== 0) throw new TypeError("connection: invalid binary response fields");
			return {
				rpcId: full.rpcId,
				result: {
					ok: true,
					value: root.value
				}
			};
		}
		function parseConnectionResponse(value) {
			if (!isRecord(value) || value.type !== "server-response" || typeof value.rpcId !== "string") throw new TypeError("connection: invalid server-response envelope");
			const result = value.result;
			if (!isRecord(result)) throw new TypeError("connection: invalid server-response result");
			if (result.ok === true) return {
				rpcId: RpcId(value.rpcId),
				result: {
					ok: true,
					value: result.value
				}
			};
			if (result.ok !== false || !isRecord(result.error)) throw new TypeError("connection: invalid server-response result");
			const error = result.error;
			if (typeof error.code !== "string" || typeof error.message !== "string" || !isRecord(error.details)) throw new TypeError("connection: invalid server-response failure");
			return {
				rpcId: RpcId(value.rpcId),
				result: {
					ok: false,
					error: {
						code: error.code,
						message: error.message,
						details: error.details
					}
				}
			};
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function assertTarget(channel, endpoint) {
			const segments = endpoint.split("/");
			if (!CHANNEL_PATTERN.test(channel) || segments.some((segment) => segment === "" || segment === "." || segment === ".." || !ENDPOINT_SEGMENT_PATTERN.test(segment))) throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`);
		}
		//#endregion
		//#region lib/types/loopback-hostname.js
		/**
		* Browser-safe, zero-dependency loopback classification shared by the `/api`
		* Host fence and the package's `ctx.connection` state. The predicate stays
		* package-internal; client plugins consume the derived state through Cordis.
		*/
		/**
		* Whether a normalized URL hostname names the local loopback authority.
		* @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
		* @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
		*/
		function isLoopbackHostname(hostname) {
			if (hostname === "localhost" || hostname === "[::1]") return true;
			const parts = hostname.split(".");
			return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Required services (none — this is the wire root). */
		const inject = [];
		function watchBrowserNetwork(controller) {
			const browser = globalThis.window;
			const initiallyAvailable = browser?.navigator?.onLine;
			if (browser === void 0 || initiallyAvailable === void 0) return () => {};
			const online = () => {
				controller.setNetworkAvailable(true);
			};
			const offline = () => {
				controller.setNetworkAvailable(false);
			};
			controller.setNetworkAvailable(initiallyAvailable);
			browser.addEventListener("online", online);
			browser.addEventListener("offline", offline);
			return () => {
				browser.removeEventListener("online", online);
				browser.removeEventListener("offline", offline);
			};
		}
		/**
		* Install one Context-owned Connection service from explicit composition inputs.
		* @param ctx - client Cordis context.
		* @param options - physical carrier, reconnect timing, and page location.
		*/
		function installConnection(ctx, options = {}) {
			const pageLocation = options.location;
			const transport = options.transport;
			const recovery = options.recovery ?? {};
			const rpc = transport?.rpc ?? createWebConnectionRpc(transport?.fetch, transport?.openStream);
			let generationSource;
			let owner;
			let generationId = 0;
			let generation;
			let state;
			const generationListeners = /* @__PURE__ */ new Set();
			const stateListeners = /* @__PURE__ */ new Set();
			const publishGeneration = (next) => {
				if (Object.is(generation, next)) return;
				generation = next;
				for (const listener of [...generationListeners]) try {
					listener();
				} catch (error) {
					console.error("[connection] generation listener threw:", error);
				}
			};
			const publishState = (next) => {
				if (state === next) return;
				state = next;
				for (const listener of [...stateListeners]) try {
					listener();
				} catch (error) {
					console.error("[connection] state listener threw:", error);
				}
			};
			const releaseOwner = (current) => {
				if (owner !== current) return;
				owner = void 0;
				current.stopNetworkWatch();
				current.controller.stop();
				publishGeneration(void 0);
				publishState(void 0);
			};
			const handle = {
				isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),
				generation: {
					getSnapshot: () => generation,
					subscribe: (listener) => {
						generationListeners.add(listener);
						return () => {
							generationListeners.delete(listener);
						};
					}
				},
				state: {
					getSnapshot: () => state,
					subscribe: (listener) => {
						stateListeners.add(listener);
						return () => {
							stateListeners.delete(listener);
						};
					}
				},
				rpc,
				reconnect() {
					owner?.controller.reconnect();
				},
				registerGenerationSource(source) {
					if (generationSource !== void 0) throw new Error("connection: a generation source is already registered");
					generationSource = source;
					return () => {
						if (generationSource !== source) return;
						generationSource = void 0;
						const current = owner;
						if (current?.source === source) releaseOwner(current);
					};
				},
				start(sinks, config) {
					if (owner !== void 0) throw new Error("connection: the stream loop is already owned by another consumer");
					const source = generationSource;
					if (source === void 0) throw new Error("connection: no generation source is registered");
					const token = {};
					const ownsGeneration = () => owner?.token === token;
					const controller = new ConnectionController(source, {
						...sinks,
						onConnected: (host) => {
							const nextGeneration = {
								id: ++generationId,
								host
							};
							publishGeneration(nextGeneration);
							if (!ownsGeneration() || !Object.is(generation, nextGeneration)) return;
							sinks.onConnected?.(host);
						},
						onStateChange: (state) => {
							if (state !== "connected") publishGeneration(void 0);
							if (!ownsGeneration()) return;
							publishState(state);
							sinks.onStateChange?.(state);
						}
					}, {
						...recovery,
						...config
					});
					const current = {
						token,
						source,
						controller,
						stopNetworkWatch: watchBrowserNetwork(controller)
					};
					owner = current;
					controller.start();
					return { stop: () => {
						releaseOwner(current);
					} };
				}
			};
			ctx.provide("connection", handle);
		}
		/**
		* Client plugin body: read the page composition and install its Connection service.
		* @param ctx - client Cordis context.
		*/
		function apply(ctx) {
			const globals = globalThis;
			const pageLocation = typeof location === "undefined" ? void 0 : location;
			const transport = globals.__DSH_TRANSPORT__;
			installConnection(ctx, {
				...transport === void 0 ? {} : { transport },
				recovery: resolveConnectionConfig(globals.__DSH_CONNECTION_RECOVERY__),
				...pageLocation === void 0 ? {} : { location: pageLocation }
			});
		}
		//#endregion
		exports.RpcId = RpcId;
		exports.apply = apply;
		exports.inject = inject;
		exports.installConnection = installConnection;
		exports.transportError = transportError;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-api-workspace-controller",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_api_gateway_client = require("@deepseek-ai/dsh-api-gateway/client");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		//#region lib/types/client/model.js
		/** Client-side Workspace state model shared by Remote transport and UI projection. */
		/**
		* Owns the Client Workspace projection, mutation echoes, and stream/unary race resolution.
		*/
		var ClientWorkspaceModel = class {
			remote;
			items = [];
			archivedSessionIds = [];
			pinnedSessionIds = [];
			state = "loading";
			phase = "pending";
			error = null;
			/** Latest local reorder request; only its unary echo may install order. */
			orderRequestGeneration = 0;
			/** Increments on stream orders so a later remote commit outranks an older unary echo. */
			orderFrameGeneration = 0;
			/** Last complete order accepted from a baseline, increment, or current unary echo. */
			committedOrder = [];
			/** Latest archive-set request; a later request or a pushed set supersedes it. */
			archiveRequestSeq = 0;
			/** Latest pin-set request; a later request or a pushed set supersedes it. */
			pinRequestSeq = 0;
			/** Host Workspace ids are never reused, so delayed data cannot resurrect a removed row. */
			removedIds = /* @__PURE__ */ new Set();
			listeners = /* @__PURE__ */ new Set();
			snapshotCache;
			snapshotDirty = false;
			notificationPending = false;
			notificationScheduled = false;
			notificationGeneration = 0;
			/** @param remote - generated Workspace Remote namespace. */
			constructor(remote) {
				this.remote = remote;
				this.snapshotCache = this.buildSnapshot();
			}
			/**
			* Create or resolve a Workspace and merge the unary result immediately.
			* @param input - existing absolute path to adopt.
			* @returns generated Remote result.
			*/
			async create(input) {
				const result = await this.remote.create(input);
				if (result.ok) this.upsert(result.value.workspace);
				return result;
			}
			/**
			* Initialize the default Workspace and merge its authoritative row.
			* @param signal - caller lifetime.
			* @returns generated Remote result.
			*/
			async initializeDefault(signal) {
				const result = await this.remote.initializeDefault(signal);
				if (result.ok && result.value !== void 0) this.upsert(result.value.workspace);
				return result;
			}
			/**
			* Rename a Workspace and merge the unary result immediately.
			* @param workspaceId - target Workspace.
			* @param title - new display title.
			* @returns generated Remote result.
			*/
			async rename(workspaceId, title) {
				const result = await this.remote.rename({
					workspaceId,
					title
				});
				if (result.ok) this.upsert(result.value.workspace);
				return result;
			}
			/**
			* Delete a Workspace and remove it from the local projection immediately.
			* @param workspaceId - target Workspace.
			* @returns generated Remote result.
			*/
			async delete(workspaceId) {
				const result = await this.remote.delete({ workspaceId });
				if (result.ok) this.remove(workspaceId, true);
				return result;
			}
			/**
			* Optimistically move a Workspace and reconcile the returned complete order.
			* @param workspaceId - Workspace to move.
			* @param beforeWorkspaceId - anchor Workspace; omitted appends.
			* @returns generated Remote result.
			*/
			async insertBefore(workspaceId, beforeWorkspaceId) {
				const requestGeneration = ++this.orderRequestGeneration;
				const frameGeneration = this.orderFrameGeneration;
				const localOrder = this.items.map((workspace) => workspace.workspaceId);
				this.installOrder(insertIdBefore(localOrder, workspaceId, beforeWorkspaceId));
				const result = await this.remote.insertBefore({
					workspaceId,
					...beforeWorkspaceId === void 0 ? {} : { beforeWorkspaceId }
				});
				if (requestGeneration === this.orderRequestGeneration && frameGeneration === this.orderFrameGeneration) this.installOrder(result.ok ? result.value.workspaceIds : this.committedOrder, result.ok);
				return result;
			}
			/**
			* Move a Session within its Workspace and merge the returned row.
			* @param workspaceId - owning Workspace.
			* @param sessionId - accounted Session to move.
			* @param beforeSessionId - accounted anchor; omitted appends.
			* @returns generated Remote result.
			*/
			async insertSessionBefore(workspaceId, sessionId, beforeSessionId) {
				const result = await this.remote.insertSessionBefore({
					workspaceId,
					sessionId,
					...beforeSessionId === void 0 ? {} : { beforeSessionId }
				});
				if (result.ok) this.upsert(result.value.workspace);
				return result;
			}
			/**
			* Archive one Session and install the returned complete archive set.
			* A reply superseded by a later archive request or a pushed set installs nothing.
			* @param sessionId - Session to archive.
			* @param options - Whether the Host stops the Session's running work instead of refusing.
			* @returns generated Remote result.
			*/
			async archiveSession(sessionId, options = {}) {
				const requestSeq = ++this.archiveRequestSeq;
				const result = await this.remote.archiveSession({
					sessionId,
					...options.stopActivity === true ? { stopActivity: true } : {}
				});
				if (result.ok && requestSeq === this.archiveRequestSeq) {
					this.installArchived(result.value.archivedSessionIds);
					this.installPinned(this.pinnedSessionIds.filter((id) => id !== sessionId));
				}
				return result;
			}
			/**
			* Unarchive one Session and install the returned complete archive set.
			* A reply superseded by a later archive request or a pushed set installs nothing.
			* @param sessionId - Session to unarchive.
			* @returns generated Remote result.
			*/
			async unarchiveSession(sessionId) {
				const requestSeq = ++this.archiveRequestSeq;
				const result = await this.remote.unarchiveSession({ sessionId });
				if (result.ok && requestSeq === this.archiveRequestSeq) this.installArchived(result.value.archivedSessionIds);
				return result;
			}
			/**
			* Pin one Session and install the returned complete pin set.
			* A reply superseded by a later pin request or a pushed set installs nothing.
			* @param sessionId - Session to pin.
			* @returns generated Remote result.
			*/
			async pinSession(sessionId) {
				const requestSeq = ++this.pinRequestSeq;
				const result = await this.remote.pinSession({ sessionId });
				if (result.ok && requestSeq === this.pinRequestSeq) this.installPinned(result.value.pinnedSessionIds);
				return result;
			}
			/**
			* Unpin one Session and install the returned complete pin set.
			* A reply superseded by a later pin request or a pushed set installs nothing.
			* @param sessionId - Session to unpin.
			* @returns generated Remote result.
			*/
			async unpinSession(sessionId) {
				const requestSeq = ++this.pinRequestSeq;
				const result = await this.remote.unpinSession({ sessionId });
				if (result.ok && requestSeq === this.pinRequestSeq) this.installPinned(result.value.pinnedSessionIds);
				return result;
			}
			/**
			* Replace the projection from one complete stream-generation baseline.
			* @param baseline - complete Workspace and archive projection.
			*/
			replaceBaseline(baseline) {
				this.orderFrameGeneration++;
				this.archiveRequestSeq++;
				this.pinRequestSeq++;
				this.installViews(baseline.items);
				this.installArchived(baseline.archivedSessionIds);
				this.installPinned(baseline.pinnedSessionIds);
				this.state = "idle";
				this.phase = "ready";
				this.error = null;
				this.invalidate();
			}
			/** Merge one decoded Workspace upsert from the current follow generation. */
			upsertView(workspace) {
				this.upsert(workspace);
			}
			/** Apply one decoded Workspace removal from the current follow generation. */
			removeView(workspaceId) {
				this.remove(workspaceId);
			}
			/** Replace Host-confirmed order from the current follow generation. */
			replaceOrder(workspaceIds) {
				this.orderFrameGeneration++;
				this.installOrder(workspaceIds, true);
			}
			/**
			* Replace the archived Session set from the current follow generation.
			* @param archivedSessionIds - complete Host-confirmed archive set.
			*/
			replaceArchived(archivedSessionIds) {
				this.archiveRequestSeq++;
				this.installArchived(archivedSessionIds);
			}
			/**
			* Replace the pinned Session set from the current follow generation.
			* @param pinnedSessionIds - complete Host-confirmed pin set, most recently pinned first.
			*/
			replacePinned(pinnedSessionIds) {
				this.pinRequestSeq++;
				this.installPinned(pinnedSessionIds);
			}
			/** Keep the last complete projection visible while a lost carrier reconnects. */
			handleCarrierFailure() {
				this.state = "loading";
				this.error = null;
				this.invalidate();
			}
			/**
			* Publish a non-retryable stream or protocol failure.
			* @param error - terminal stream failure.
			*/
			handleStreamFailure(error) {
				if (!(0, _deepseek_ai_dsh_api_gateway_client.isRemoteFailure)(error)) throw error;
				this.state = "error";
				this.error = error;
				this.invalidate();
			}
			/**
			* Subscribe to Workspace state invalidation.
			* @param listener - invalidation callback.
			* @returns unsubscribe function.
			*/
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/**
			* Read the cached state, rebuilding it first when necessary.
			* @returns the current stable Workspace list snapshot.
			*/
			getSnapshot() {
				this.refreshSnapshot();
				return this.snapshotCache;
			}
			buildSnapshot() {
				return {
					items: this.items,
					archivedSessionIds: this.archivedSessionIds,
					pinnedSessionIds: this.pinnedSessionIds,
					state: this.state,
					phase: this.phase,
					error: this.error
				};
			}
			installArchived(archivedSessionIds) {
				if (archivedSessionIds.length === this.archivedSessionIds.length && archivedSessionIds.every((id, index) => id === this.archivedSessionIds[index])) return;
				this.archivedSessionIds = [...archivedSessionIds];
				this.invalidate();
			}
			installPinned(pinnedSessionIds) {
				if (pinnedSessionIds.length === this.pinnedSessionIds.length && pinnedSessionIds.every((id, index) => id === this.pinnedSessionIds[index])) return;
				this.pinnedSessionIds = [...pinnedSessionIds];
				this.invalidate();
			}
			installOrder(workspaceIds, committed = false) {
				if (committed) this.committedOrder = [...workspaceIds];
				const rank = new Map(workspaceIds.map((id, index) => [id, index]));
				const items = [...this.items].sort((left, right) => (rank.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER));
				if (items.every((item, index) => item === this.items[index])) return;
				this.items = items;
				this.invalidate();
			}
			upsert(view) {
				if (this.removedIds.has(view.workspaceId)) return;
				const index = this.items.findIndex((item) => item.workspaceId === view.workspaceId);
				const installed = this.items[index];
				if (installed !== void 0 && Date.parse(view.updatedAt) < Date.parse(installed.updatedAt)) return;
				if (!this.committedOrder.includes(view.workspaceId)) this.committedOrder = [view.workspaceId, ...this.committedOrder];
				this.items = index === -1 ? [view, ...this.items] : this.items.map((item, position) => position === index ? view : item);
				this.invalidate();
			}
			remove(workspaceId, immediate = false) {
				this.removedIds.add(workspaceId);
				this.committedOrder = this.committedOrder.filter((id) => id !== workspaceId);
				const items = this.items.filter((item) => item.workspaceId !== workspaceId);
				if (items.length === this.items.length) {
					if (immediate) this.invalidate(true);
					return;
				}
				this.items = items;
				this.invalidate(immediate);
			}
			installViews(views) {
				const installed = /* @__PURE__ */ new Map();
				for (const view of views) if (!this.removedIds.has(view.workspaceId)) installed.set(view.workspaceId, view);
				this.items = [...installed.values()];
				this.committedOrder = views.map((view) => view.workspaceId);
			}
			invalidate(immediate = false) {
				this.snapshotDirty = true;
				this.notificationPending = true;
				if (immediate) {
					this.notificationGeneration++;
					this.notificationScheduled = false;
					this.flush();
					return;
				}
				if (this.notificationScheduled) return;
				this.notificationScheduled = true;
				const generation = ++this.notificationGeneration;
				queueMicrotask(() => {
					if (generation !== this.notificationGeneration) return;
					this.notificationScheduled = false;
					this.flush();
				});
			}
			flush() {
				if (!this.notificationPending || this.listeners.size === 0) return;
				this.notificationPending = false;
				this.refreshSnapshot();
				(0, _deepseek_ai_dsh_client_store.notifySubscribers)(this.listeners, "[workspace-controller]");
			}
			refreshSnapshot() {
				if (!this.snapshotDirty) return;
				this.snapshotDirty = false;
				this.snapshotCache = this.buildSnapshot();
			}
		};
		function insertIdBefore(ids, id, beforeId) {
			if (!ids.includes(id) || beforeId !== void 0 && !ids.includes(beforeId) || beforeId === id) return [...ids];
			const without = ids.filter((candidate) => candidate !== id);
			const at = beforeId === void 0 ? without.length : without.indexOf(beforeId);
			return [
				...without.slice(0, at),
				id,
				...without.slice(at)
			];
		}
		//#endregion
		//#region lib/types/client/service.js
		/** React-free Client Workspace service and command facade. */
		/** Structured create failure for callers that distinguish Host business errors. */
		var WorkspaceCreateError = class extends Error {
			rpcError;
			name = "WorkspaceCreateError";
			/** @param rpcError - Host business or folded carrier failure. */
			constructor(rpcError) {
				super(`workspace create failed: ${rpcError.code}: ${rpcError.message}`);
				this.rpcError = rpcError;
			}
		};
		/**
		* Archive failed on the Host. `rpcError.code` distinguishes the active-session
		* refusal (`workspace/session-active`, whose details name what still runs)
		* from a missing session or a carrier fault.
		*/
		var WorkspaceArchiveError = class extends Error {
			rpcError;
			name = "WorkspaceArchiveError";
			/** @param rpcError - Host business or folded carrier failure. */
			constructor(rpcError) {
				super(`workspace session archive failed: ${rpcError.code}: ${rpcError.message}`);
				this.rpcError = rpcError;
			}
		};
		/** Owns the bare Workspace snapshot and Workspace-only commands. */
		var WorkspaceController = class extends _deepseek_ai_cordis.Service {
			model;
			list;
			/**
			* @param ctx - Client root Context.
			* @param model - Remote-backed Workspace state model.
			*/
			constructor(ctx, model) {
				super(ctx, "workspaces");
				this.model = model;
				this.list = model;
			}
			async create(input) {
				const result = await this.model.create(input);
				if (!result.ok) throw new WorkspaceCreateError(result.error);
				return result.value.workspace;
			}
			async initializeDefault(signal) {
				const result = await this.model.initializeDefault(signal);
				if (!result.ok) throw new WorkspaceCreateError(result.error);
				return result.value?.workspace;
			}
			async rename(workspaceId, title) {
				const result = await this.model.rename(workspaceId, title);
				if (!result.ok) throw commandError("rename", result.error);
				return result.value.workspace;
			}
			async delete(workspaceId) {
				const result = await this.model.delete(workspaceId);
				if (!result.ok) throw commandError("delete", result.error);
			}
			async insertBefore(workspaceId, beforeWorkspaceId) {
				const result = await this.model.insertBefore(workspaceId, beforeWorkspaceId);
				if (!result.ok) throw commandError("reorder", result.error);
			}
			async archiveSession(sessionId, options = {}) {
				const result = await this.model.archiveSession(sessionId, options);
				if (!result.ok) throw new WorkspaceArchiveError(result.error);
			}
			async unarchiveSession(sessionId) {
				const result = await this.model.unarchiveSession(sessionId);
				if (!result.ok) throw commandError("session unarchive", result.error);
			}
			async pinSession(sessionId) {
				const result = await this.model.pinSession(sessionId);
				if (!result.ok) throw commandError("session pin", result.error);
			}
			async unpinSession(sessionId) {
				const result = await this.model.unpinSession(sessionId);
				if (!result.ok) throw commandError("session unpin", result.error);
			}
			async insertSessionBefore(workspaceId, sessionId, beforeSessionId) {
				const result = await this.model.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
				if (!result.ok) throw commandError("move", result.error);
				return result.value.workspace;
			}
		};
		function commandError(operation, failure) {
			return /* @__PURE__ */ new Error(`workspace ${operation} failed: ${failure.code}: ${failure.message}`);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Workspace-specific adapter for the Gateway-owned snapshot stream lifecycle. */
		/** Required Client Remote services. */
		const inject = ["remote", "remote.workspace"];
		/**
		* Install Client Workspace state, commands, and reconnecting follow control.
		* @param ctx - Client root Context.
		*/
		function apply(ctx) {
			const model = new ClientWorkspaceModel(ctx.remote.workspace);
			new WorkspaceController(ctx, model);
			const control = createWorkspaceStateStream(ctx.remote, {
				accept: model,
				carrierFailed: () => {
					model.handleCarrierFailure();
				},
				failed: (error) => {
					model.handleStreamFailure(error);
				}
			});
			control.start();
			ctx.effect(() => async () => {
				await control.dispose();
			}, "workspace-controller.client.control");
		}
		/**
		* Create the reconnecting Workspace state stream.
		* @param remote - Client Remote face carrying the Workspace namespace and the stream factory.
		* @param options - Workspace state destinations.
		* @returns an unstarted stream owned by the Client Workspace runtime.
		*/
		function createWorkspaceStateStream(remote, options) {
			return new _deepseek_ai_dsh_api_gateway_client.RemoteSnapshotStream(remote.$stream({
				name: "Workspace state stream",
				open: (signal) => remote.workspace.follow(signal),
				ended: (accepted) => accepted ? new _deepseek_ai_dsh_api_gateway_client.RemoteStreamCarrierError("Workspace state stream ended without a terminal result") : /* @__PURE__ */ new Error("Workspace state stream ended before its opening snapshot"),
				...options.carrierFailed === void 0 ? {} : { carrierFailed: options.carrierFailed }
			}), {
				name: "Workspace state stream",
				isSnapshot: (frame) => frame.type === "baseline",
				replace: (frame) => {
					options.accept.replaceBaseline(frame.value);
				},
				update: (frame) => {
					acceptIncrement(options.accept, frame);
				},
				failed: options.failed
			});
		}
		function acceptIncrement(accept, frame) {
			switch (frame.type) {
				case "upsert":
					accept.upsertView(frame.workspace);
					return;
				case "remove":
					accept.removeView(frame.workspaceId);
					return;
				case "order":
					accept.replaceOrder(frame.workspaceIds);
					return;
				case "archived":
					accept.replaceArchived(frame.archivedSessionIds);
					return;
				case "pinned":
					accept.replacePinned(frame.pinnedSessionIds);
					return;
				/* v8 ignore next -- the generated Remote codec validates this closed union */
				default: return assertNever(frame);
			}
		}
		/* v8 ignore next 3 -- closed-union backstop after generated Remote validation */
		function assertNever(value) {
			throw new Error(`unreachable Workspace increment: ${JSON.stringify(value)}`);
		}
		//#endregion
		exports.ClientWorkspaceModel = ClientWorkspaceModel;
		exports.WorkspaceArchiveError = WorkspaceArchiveError;
		exports.WorkspaceController = WorkspaceController;
		exports.WorkspaceCreateError = WorkspaceCreateError;
		exports.apply = apply;
		exports.createWorkspaceStateStream = createWorkspaceStateStream;
		exports.inject = inject;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-api-session-controller",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		let _deepseek_ai_dsh_api_gateway_client = require("@deepseek-ai/dsh-api-gateway/client");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region ../../typert/protocol/lib/index.js
		/** The one Remote failure class shared by owners, the Gateway, and consumers. */
		/**
		* One Remote call failure: a real Error carrying its stable code and typed
		* details. Owners throw it at the failure point; the Host Gateway encodes it
		* onto the wire unchanged; the Client face rebuilds an instance for the
		* `RemoteResult` error branch, so `throw result.error` keeps throw semantics.
		* Discrimination is always by `code`, never by instanceof.
		*/
		var RemoteError = class extends Error {
			code;
			details;
			/** Structural marker: cross-realm/bundle identification never uses instanceof. */
			isDSHRemoteError = true;
			/**
			* @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
			* @param message - human diagnostic carried across the wire.
			* @param details - structured payload typed by the code.
			* @param options - standard Error options (`cause` survives in-process only).
			*/
			constructor(code, message, details, options) {
				super(message, options);
				this.code = code;
				this.details = details;
				this.name = "RemoteError";
			}
		};
		/** Generic invocation-owned values returned by synchronous Client Context resolvers. */
		/** Shared identity across independently bundled Context providers and Gateway. */
		const TYPERT_OWNED_VALUE = Symbol.for("dsh.typert.owned-value");
		/**
		* Transfer cleanup ownership without adding another resource reference count.
		* @param value - resolved payload passed to the invocation.
		* @param release - non-throwing synchronous release, called at most once.
		* @returns an owned payload disposed after invocation and reply settlement.
		*/
		function typertOwnedValue(value, release) {
			let active = true;
			return {
				[TYPERT_OWNED_VALUE]: true,
				value,
				[Symbol.dispose]() {
					if (!active) return;
					active = false;
					release();
				}
			};
		}
		//#endregion
		//#region lib/types/client/sessions/history-records.js
		/** Client range access and type narrowing for aligned Session history records. */
		/**
		* Narrow aligned wire records to their Client event types without allocation.
		* @param records - validated history transport records.
		* @returns the same record array with typed inner events.
		*/
		function historyEntries(records) {
			return records;
		}
		/**
		* Read the first logical sequence represented by one wire record.
		* @param record - validated Session event.
		* @returns inclusive first Session sequence.
		*/
		function historyRecordFirstSeq(record) {
			return record.event.seq;
		}
		/**
		* Read the final logical sequence represented by one wire record.
		* @param record - validated Session event.
		* @returns inclusive final Session sequence.
		*/
		function historyRecordLastSeq(record) {
			return record.event.seq;
		}
		//#endregion
		//#region ../../util/brand/lib/index.js
		/**
		* Apply a compile-time number brand without changing the value.
		* @param value - number admitted by the domain that owns the target brand.
		* @returns the same number with the requested compile-time brand.
		*/
		function brandNumber(value) {
			return value;
		}
		//#endregion
		//#region ../../core/session/lib/types/types.js
		/**
		* Admit a numeric value as an existing Session event position.
		* @param value - non-negative safe integer admitted by the owning log operation.
		* @returns the same number with the Session-sequence brand.
		*/
		function SessionSeq(value) {
			if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionSeq must be a non-negative safe integer, got ${String(value)}`);
			return brandNumber(value);
		}
		/**
		* Admit a numeric value as a Session log offset.
		* @param value - non-negative safe integer used as a gap or prefix length.
		* @returns the same number with the Session-log-offset brand.
		*/
		function SessionLogOffset(value) {
			if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionLogOffset must be a non-negative safe integer, got ${String(value)}`);
			return brandNumber(value);
		}
		//#endregion
		//#region ../../core/session/lib/types/known-event-types.js
		/**
		* GENERATED by `scripts/gen-persistence-catalog.ts` — do not edit by hand; run
		* `pnpm run gen-persistence-catalog` to regenerate (verified fresh by
		* `pnpm run verify-persistence-catalog`, part of `doc-sync`).
		* @module @deepseek-ai/dsh-session/known-event-types
		*/
		/**
		* Every `SessionEventMap` member declared in this repository — the event
		* vocabulary this build understands. The persistence read path refuses to
		* interpret a log containing a type outside this set unless the event
		* carries the envelope's `ignorable` marker (see `SessionEvent.ignorable`
		* in `./types.ts`): such a log was likely written by a newer harness, and
		* silently skipping a required event would reconstruct a wrong session.
		* Downstream (out-of-repo) plugin events are outside this list by
		* construction. The persisted `SessionEvent.ignorable` marker is the
		* compatibility mechanism; event-name registration was rejected because
		* it does not classify omission safety and would make reads
		* composition-dependent. The rationale is in
		* `.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md`.
		*/
		const KNOWN_SESSION_EVENT_TYPES = new Set([
			"agent-preset/selected",
			"agent/inbox/spliced",
			"approval/asked",
			"approval/decided",
			"approval/policy",
			"assistant/attempt",
			"assistant/message",
			"command/done",
			"command/run",
			"compaction/end",
			"compaction/prune",
			"compaction/start",
			"compaction/summary",
			"deliverables/presented",
			"developer/message",
			"feedback/message-delete",
			"feedback/message-put",
			"feedback/record",
			"goal/change",
			"hook/invoked",
			"hook/result",
			"image/offload",
			"llm/retry",
			"llm/retry-started",
			"model/selection",
			"permission/preset",
			"plan/mode",
			"request/context",
			"request/header",
			"sandbox/mode",
			"schedule/change",
			"session-log-deepseek/delivery-accepted",
			"session/end-seed",
			"session/title",
			"session/title-llm-request",
			"step/end",
			"step/start",
			"subagent/catalog",
			"subagent/descriptor",
			"subagent/model-selection-policy",
			"system/message",
			"team/member",
			"team/message/delivered",
			"team/message/queued",
			"team/task",
			"todo/write",
			"tool-workflow/agent-end",
			"tool-workflow/agent-start",
			"tool-workflow/run-end",
			"tool-workflow/run-start",
			"tool/call",
			"tool/ptc-dispatch",
			"tool/ptc-dispatch-start",
			"tool/result",
			"turn/end",
			"turn/start",
			"user/message",
			"web/deepseek-search-llm-request",
			"workspace/changes"
		]);
		//#endregion
		//#region ../../core/session/lib/types/surface.js
		/** Runtime counterpart of the message-producing event union. */
		const SURFACE_EVENT_TYPES = new Set([
			"system/message",
			"developer/message",
			"user/message",
			"assistant/message",
			"tool/result"
		]);
		/**
		* Whether an event type can join the model-visible surface.
		* @param type - event type to test.
		* @returns true for one of the message-producing event types.
		*/
		function isSurfaceEligibleType(type) {
			return SURFACE_EVENT_TYPES.has(type);
		}
		/** Whether a payload field is a JSON object rather than an array or scalar. */
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/**
		* Reject noncanonical request-header fields, developer roles/content, and contradictory tool failure metadata.
		* This does not validate complete event payloads or embedded provider streams.
		* @param event - event whose locally related payload fields are inspected.
		* @param subject - event location to include in validation errors.
		* @throws when request-header fields, developer roles/content, or tool failure metadata are invalid.
		*/
		function validateSessionEventData(event, subject) {
			const data = event.data;
			if (SURFACE_EVENT_TYPES.has(event.type) && isRecord(data)) {
				const message = event.type === "user/message" ? data : data["message"];
				if (isRecord(message)) {
					if (event.type === "developer/message" !== (message["role"] === "developer")) throw new Error(`${subject} developer/message and developer role must occur together`);
					if (message["role"] !== "developer" && Array.isArray(message["content"]) && message["content"].some((block) => isRecord(block) && (block["type"] === "tool-addition" || block["type"] === "tool-removal"))) throw new Error(`${subject} tool-change blocks require developer role`);
					if (event.type === "developer/message" && Array.isArray(message["content"])) {
						let hasAdditions = false;
						for (const block of message["content"]) {
							if (!isRecord(block) || block["type"] !== "tool-addition" && block["type"] !== "tool-removal") continue;
							if (typeof block["toolName"] !== "string" || block["toolName"].length === 0) throw new Error(`${subject} ${block["type"]} requires a nonempty toolName`);
							if (block["type"] === "tool-addition") {
								hasAdditions = true;
								if (Object.hasOwn(block, "tool")) throw new Error(`${subject} tool-addition must omit inline tool definitions`);
							}
						}
						if (hasAdditions ? !isEventSeq(data["headerSeq"]) : Object.hasOwn(data, "headerSeq")) throw new Error(`${subject} requires headerSeq exactly when tool additions are present`);
					}
				}
			}
			if (event.type === "request/header") {
				if (!isRecord(data)) throw new Error(`${subject} data must be an object`);
				const header = data["header"];
				if (!isRecord(header)) throw new Error(`${subject} header must be an object`);
				if (Object.hasOwn(header, "system")) throw new Error(`${subject} must omit header.system; use system/message`);
				if (Array.isArray(header["tools"]) && header["tools"].length === 0) throw new Error(`${subject} must omit empty tools`);
				const defaults = header["adapterDefaults"];
				if (isRecord(defaults) && Object.keys(defaults).length === 0) throw new Error(`${subject} must omit empty adapterDefaults`);
			} else if (event.type === "tool/result") {
				if (!isRecord(data)) throw new Error(`${subject} data must be an object`);
				if (data["error"] === void 0) return;
				const message = data["message"];
				if (!isRecord(message) || message["isError"] !== true) throw new Error(`${subject} error requires message.isError === true`);
			}
		}
		/** Whether a runtime value is a non-negative safe event sequence. */
		function isEventSeq(value) {
			return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
		}
		/** Whether a runtime value is the exact positional-replacement shape. */
		function isReplaceOp(value) {
			const op = value;
			return Object.keys(op).length === 3 && Object.hasOwn(op, "op") && Object.hasOwn(op, "startSeq") && Object.hasOwn(op, "endSeq") && op["op"] === "replace" && isEventSeq(op["startSeq"]) && isEventSeq(op["endSeq"]);
		}
		/** Validate event-local surface eligibility and return its operation. */
		function surfaceOpOf(event) {
			const raw = event;
			if (!isSurfaceEligibleType(event.type)) {
				if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable === true) return;
				if (raw.surfaceOp !== void 0) throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`);
				if (raw.sourceEventSeqs !== void 0) throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs`);
				return;
			}
			const op = raw.surfaceOp;
			if (op === void 0) throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`);
			if (op === "append") return op;
			if (op === null || typeof op !== "object" || Array.isArray(op)) throw new Error(`session event "${event.type}" carries an invalid surfaceOp`);
			if (!isReplaceOp(op)) throw new Error(`session event "${event.type}" carries an invalid replace surfaceOp`);
			return op;
		}
		/** Validate cited source-event seqs against prior log entries and the replacement range. */
		function assertSourceEventReferences(event, shadowedSeqs) {
			const raw = event.sourceEventSeqs;
			if (event.type === "assistant/message" && raw !== void 0) throw new Error("assistant/message embeds its source stream and cannot carry sourceEventSeqs");
			const sources = /* @__PURE__ */ new Set();
			if (raw !== void 0) {
				if (!Array.isArray(raw)) throw new Error(`sourceEventSeqs on event at seq ${event.seq} must be an array when present`);
				if (raw.length === 0) throw new Error("sourceEventSeqs must not be empty");
				let nonEarlierSource;
				for (const source of raw) {
					if (!isEventSeq(source)) throw new Error(`session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers`);
					sources.add(source);
					if (nonEarlierSource === void 0 && source >= event.seq) nonEarlierSource = source;
				}
				if (sources.size !== raw.length) throw new Error("sourceEventSeqs must not contain duplicates");
				if (nonEarlierSource !== void 0) throw new Error(`sourceEventSeqs must reference earlier events: ${nonEarlierSource} >= current seq ${event.seq}`);
			}
			const missing = shadowedSeqs.filter((seq) => !sources.has(seq));
			if (missing.length > 0) throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(", ")}`);
		}
		/**
		* Validate one event's surface metadata without checking membership in a log or surface.
		* @param event - event whose marker and source sequence values are inspected.
		* Unknown ignorable records retain opaque metadata and never change the surface.
		* @returns the validated operation, or undefined for a log-only or unknown ignorable event.
		* @throws when metadata violates event-local eligibility, marker, or source-sequence rules.
		*/
		function validateSurfaceMetadata(event) {
			const op = surfaceOpOf(event);
			if (op !== void 0 && op !== "append" && (op.startSeq >= event.seq || op.endSeq >= event.seq)) throw new Error(`surface replace at seq ${event.seq}: startSeq and endSeq must reference earlier events`);
			if (op !== void 0) assertSourceEventReferences(event, []);
			return op;
		}
		//#endregion
		//#region lib/types/client/session-wire-event.js
		/** Event-local acceptance for raw Session journal responses; payloads remain owner-defined JSON. */
		/**
		* Reject non-current event envelopes without stripping or normalizing wire fields.
		* Range membership and source existence require the durable log and remain Host-owned.
		* @param value - one event received in a follow frame or history page.
		* @returns nothing after narrowing the accepted event envelope.
		* @throws when the envelope or current event-local metadata is invalid.
		*/
		function assertSessionWireEvent(value) {
			const subject = "session wire event";
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${subject} must be an object`);
			const event = value;
			for (const key of Object.keys(event)) switch (key) {
				case "type":
				case "seq":
				case "time":
				case "data":
				case "ignorable":
				case "surfaceOp":
				case "sourceEventSeqs": break;
				default: throw new Error(`${subject} has unexpected field ${key}`);
			}
			const seq = event["seq"];
			if (typeof event["type"] !== "string" || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 || Object.is(seq, -0) || typeof event["time"] !== "number" || !Number.isSafeInteger(event["time"]) || !Object.hasOwn(event, "data") || event["data"] === void 0 || Object.hasOwn(event, "ignorable") && event["ignorable"] !== true) throw new Error(`${subject} has an invalid envelope`);
			const current = event;
			validateSurfaceMetadata(current);
			validateSessionEventData(current, subject);
		}
		//#endregion
		//#region lib/types/types.js
		/** Maximum number of Sessions returned by one search. */
		const SESSION_SEARCH_RESULT_LIMIT = 20;
		/** Maximum search snippet length in Unicode code points. */
		const SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240;
		//#endregion
		//#region lib/types/client/transport.js
		/** Session-specific adapters for Gateway-owned Remote stream lifecycles. */
		function toSessionJournalChange(change) {
			switch (change.type) {
				case "replace":
				case "prepend": return {
					...change,
					entries: historyEntries(change.entries)
				};
				case "append": return {
					type: "append",
					entry: change.entry
				};
				case "notification": return {
					type: "assistant-stream",
					frame: change.notification
				};
			}
		}
		/**
		* Create the Host-wide Session control snapshot stream.
		* @param remote - generated Session namespace and Gateway stream factory.
		* @param options - Session state destinations.
		* @returns an unstarted stream owned by the Client Session runtime.
		*/
		function createSessionControlStream(remote, options) {
			return new _deepseek_ai_dsh_api_gateway_client.RemoteSnapshotStream(remote.$stream({
				name: "session control stream",
				open: (signal) => remote.session.control(signal),
				ended: (accepted) => accepted ? new _deepseek_ai_dsh_api_gateway_client.RemoteStreamCarrierError("session control stream ended without a terminal result") : /* @__PURE__ */ new Error("session control stream ended before its opening snapshot"),
				...options.carrierFailed === void 0 ? {} : { carrierFailed: options.carrierFailed }
			}), {
				name: "session control stream",
				isSnapshot: (frame) => frame.type === "baseline",
				replace: options.accept,
				update: options.accept,
				failed: options.failed
			});
		}
		/** Gateway-owned event journal bound to one ordinary or direct-subagent Session address. */
		var SessionEventStream = class extends _deepseek_ai_dsh_api_gateway_client.RemoteJournalStream {
			remote;
			address;
			/**
			* @param remote - generated Session namespace and Gateway stream factory.
			* @param address - durable ordinary-Session or direct-subagent address.
			* @param options - Session event-window destinations.
			*/
			constructor(remote, address, options) {
				super(remote, {
					name: "session event stream",
					emptyCursor: -1,
					entries: (page) => page.records,
					hasMore: (page) => page.hasMore,
					first: historyRecordFirstSeq,
					last: historyRecordLastSeq,
					compare: (left, right) => left - right,
					follows: (left, right) => right === left + 1,
					publish: (change) => {
						options.publish(toSessionJournalChange(change));
					},
					...options.carrierFailed === void 0 ? {} : { carrierFailed: options.carrierFailed },
					failed: options.failed
				});
				this.remote = remote;
				this.address = address;
			}
			/** @inheritdoc */
			async *follow(request, signal) {
				let assistantRevision;
				for await (const frame of this.remote.session.follow({
					address: this.address,
					assistantStream: true,
					...this.repairRequest(request)
				}, signal)) {
					if (frame.type === "snapshot") {
						for (const record of frame.records) assertSessionWireEvent(record.event);
						if (frame.assistantStream === void 0) throw new RemoteError("gateway/internal", "session assistant stream omitted its opted-in opening baseline", {});
						assistantRevision = frame.assistantStream.revision;
						yield {
							type: "opened",
							cursor: frame.cursor,
							page: {
								records: frame.records,
								hasMore: frame.hasMore,
								projections: frame.projections,
								assistantStream: frame.assistantStream
							}
						};
						continue;
					}
					if (frame.type === "assistant-stream") {
						const expected = (assistantRevision ?? 0) + 1;
						if (frame.frame.revision !== expected) throw new _deepseek_ai_dsh_api_gateway_client.RemoteStreamCarrierError(`session assistant stream skipped revision ${String(expected)}`);
						assistantRevision = frame.frame.revision;
						yield {
							type: "notification",
							notification: frame.frame
						};
						continue;
					}
					assertSessionWireEvent(frame.event);
					yield {
						type: "entry",
						entry: frame
					};
				}
			}
			/** @inheritdoc */
			async readPage(request, throughSeq, signal) {
				const result = await this.remote.session.page({
					address: this.address,
					throughSeq,
					...request
				}, signal);
				if (!result.ok) throw result.error;
				for (const record of result.value.records) assertSessionWireEvent(record.event);
				return result.value;
			}
			/** @inheritdoc */
			repairRequest(request) {
				return {
					...request.maxMessages === void 0 ? {} : { maxMessages: request.maxMessages },
					...request.turnWindow === void 0 ? {} : { turnWindow: request.turnWindow }
				};
			}
		};
		//#endregion
		//#region ../../util/workspace-path/lib/index.js
		/**
		* Read the final non-empty segment of a Workspace path for display.
		* Workspace-label surfaces use this helper instead of deriving another basename.
		* @param path - Workspace directory path using POSIX or Windows separators.
		* @returns the final segment, or an empty string for a separator-only path.
		*/
		function workspaceTitleOf(path) {
			const trimmed = path.replace(/[/\\]+$/, "");
			const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
			return trimmed.slice(separator + 1);
		}
		//#endregion
		//#region lib/types/client/scope.js
		/** Client scope generations route local events independently of Host Agent residency. */
		/** Context tag written by {@link createScope}. */
		const kScope = Symbol("dsh.client.scope");
		/** Shared no-op plugin backing each Agent scope fiber. */
		function agentScope() {}
		/**
		* Mint an Agent scope under `ctx`: a no-op plugin fiber whose context
		* carries the agent tag and the dispatch filter — untagged listeners are
		* admitted globally, tagged listeners only for the same Client generation.
		* Registrations through the returned ctx dispose with the fiber.
		* @param ctx - client root context the scope fiber mounts under.
		* @param key - durable Session identity carried by this generation.
		* @returns the tagged context and its backing fiber.
		*/
		function createScope(ctx, key) {
			const fiber = ctx.plugin(agentScope);
			const identity = { sessionId: key };
			return {
				fiber,
				ctx: fiber.ctx.extend({
					[kScope]: identity,
					[_deepseek_ai_cordis.Context.filter](listenerCtx) {
						const tag = scopeIdentityOf(listenerCtx);
						return tag === void 0 || tag === identity;
					}
				})
			};
		}
		/**
		* Read the nearest agent tag inherited by a context.
		* @param ctx - any client context.
		* @returns its agent identity (the session id), or undefined for root contexts.
		*/
		function scopeOf(ctx) {
			return scopeIdentityOf(ctx)?.sessionId;
		}
		/**
		* Read the exact generation identity inherited by a Client Context.
		* @param ctx - scoped or root Client Context.
		* @returns the generation identity, or undefined for an unscoped Context.
		*/
		function scopeIdentityOf(ctx) {
			return ctx[kScope];
		}
		//#endregion
		//#region lib/types/client/ordered-baseline.js
		/**
		* Merge an authoritative baseline without moving identities already visible to
		* the client. Baseline-only identities are inserted relative to the nearest
		* following known identity; identities absent from the baseline are removed.
		*
		* @param current - the established client order.
		* @param baseline - the latest authoritative rows.
		* @param keyOf - stable identity selector.
		* @returns baseline-valued rows with the established relative order retained.
		*/
		function mergeOrderedBaseline(current, baseline, keyOf) {
			const baselineByKey = /* @__PURE__ */ new Map();
			for (const value of baseline) baselineByKey.set(keyOf(value), value);
			const merged = current.map((value) => baselineByKey.get(keyOf(value))).filter((value) => value !== void 0);
			const mergedKeys = new Set(merged.map(keyOf));
			for (let index = 0; index < baseline.length; index++) {
				const value = baseline[index];
				/* v8 ignore next -- dense-array guard: index is bounded by baseline.length. */
				if (value === void 0 || mergedKeys.has(keyOf(value))) continue;
				let insertion = merged.length;
				for (let following = index + 1; following < baseline.length; following++) {
					const candidate = baseline[following];
					/* v8 ignore next -- dense-array guard: following is bounded by baseline.length. */
					if (candidate === void 0) continue;
					const known = merged.findIndex((item) => keyOf(item) === keyOf(candidate));
					if (known !== -1) {
						insertion = known;
						break;
					}
				}
				merged.splice(insertion, 0, value);
				mergedKeys.add(keyOf(value));
			}
			return merged;
		}
		//#endregion
		//#region ../../util/values/lib/index.js
		/**
		* Lazily scanned view of one JSON object's top-level fields, built from text
		* that may still be streaming or from an already parsed object. Nothing is
		* scanned until a reader asks; the view remembers every question it answered
		* and reports changed answers when the owner refreshes for publication.
		* Used for model tool-call arguments: a row reads the fields it
		* cares about at whatever granularity it displays, at every stage of the call.
		* @module @deepseek-ai/dsh-util-values/src/partial-json
		*/
		const SIMPLE_ESCAPES = {
			"\"": "\"",
			"\\": "\\",
			"/": "/",
			b: "\b",
			f: "\f",
			n: "\n",
			r: "\r",
			t: "	"
		};
		const CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
		function isWhitespace(c) {
			return c === " " || c === "\n" || c === "\r" || c === "	";
		}
		function isHex(c) {
			return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
		}
		(class PartialArguments {
			/** The view of a call with no arguments available. */
			static EMPTY = PartialArguments.fromObject({});
			/**
			* View finished argument text without scanning it until a reader asks.
			* @param text - the complete argument JSON text.
			* @returns a sealed view.
			*/
			static fromText(text) {
				const view = new PartialArguments();
				view.append(text);
				view.sealed = true;
				return view;
			}
			/**
			* View an already parsed argument payload, such as a PTC dispatch object.
			* @param value - the parsed argument value.
			* @returns a sealed view; a non-object payload has no fields.
			*/
			static fromObject(value) {
				const view = new PartialArguments();
				view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
				view.sealed = true;
				return view;
			}
			/**
			* The source: text so far or a parsed object, plus whether it can still grow.
			* These are the only enumerable fields, so two views over the same source
			* compare equal structurally however far each has been read.
			*/
			chunks = [];
			object;
			sealed = false;
			#ends = [];
			#size = 0;
			#consumed = 0;
			#mode = "root";
			#escape = false;
			#keyStart = 0;
			#keyEscaped = false;
			#key = "";
			#current = null;
			#nestedEnds = [];
			#nestedInString = false;
			#invalidAt;
			#invalidValue = false;
			#entries = /* @__PURE__ */ new Map();
			#order = [];
			#reads = /* @__PURE__ */ new Map();
			/** Whether this view rejects further appends; does not scan text or register reads. */
			get isSealed() {
				return this.sealed;
			}
			/** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
			get invalid() {
				this.scan();
				return this.#mode === "invalid" || this.#invalidValue;
			}
			/**
			* Retain streamed argument text without scanning or comparing observed answers.
			* @param fragment - the text following every fragment appended before.
			*/
			append(fragment) {
				if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
				if (fragment.length === 0) return;
				this.chunks.push(fragment);
				this.#size += fragment.length;
				this.#ends.push(this.#size);
			}
			/**
			* Reconcile a streamed prefix with authoritative complete text without joining the fragments.
			* @param text - the final argument text, which replaces missing or conflicting deltas.
			* @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
			*/
			settle(text) {
				if (this.object !== void 0 || text.length !== this.#size) return PartialArguments.fromText(text);
				let offset = 0;
				for (const chunk of this.chunks) {
					if (!text.startsWith(chunk, offset)) return PartialArguments.fromText(text);
					offset += chunk.length;
				}
				this.chunks = text.length === 0 ? [] : [text];
				this.#ends = text.length === 0 ? [] : [text.length];
				this.sealed = true;
				return this;
			}
			/**
			* Compare observed answers and advance their publication baseline. Unread views remain unscanned.
			* @returns whether any observed answer changed since its first read or the preceding refresh.
			*/
			refresh() {
				if (this.#reads.size === 0) return false;
				this.scan();
				let changed = false;
				let completions = false;
				for (const read of this.#reads.values()) {
					if (read.completion) {
						completions = true;
						continue;
					}
					changed = this.refreshRead(read) || changed;
				}
				if (completions) {
					for (const read of this.#reads.values()) if (read.completion) changed = this.refreshRead(read) || changed;
				}
				if (this.sealed) this.#reads.clear();
				return changed;
			}
			refreshRead(read) {
				const now = read.answer();
				if (Object.is(now, read.last)) return false;
				read.last = now;
				return true;
			}
			/**
			* Check whether no further fields can arrive.
			* @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
			*/
			closed() {
				return this.remember("closed", "", () => this.closedNow());
			}
			/**
			* List discovered fields in first-appearance order.
			* @returns top-level keys seen so far, in first-appearance order.
			*/
			keys() {
				return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
			}
			/**
			* Check whether a top-level field has appeared.
			* @param key - argument name.
			* @returns whether the field has appeared (a string opened or another value began).
			*/
			has(key) {
				return this.remember("has", key, () => this.hasNow(key));
			}
			/**
			* Check whether a field's closing delimiter has arrived, without validating its contents.
			* @param key - argument name.
			* @returns whether its delimiter arrived and no content reader has reported an error for this value.
			*/
			complete(key) {
				return this.remember("complete", key, () => this.completeNow(key));
			}
			/**
			* Read string length without materializing its text.
			* @param key - argument name.
			* @param options - change granularity for a streaming string.
			* @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
			*/
			stringLength(key, options) {
				const step = Math.max(1, Math.floor(options?.step ?? 1));
				const offset = options?.offset ?? 0;
				return this.remember(`length:${step}:${offset}`, key, () => this.lengthNow(key), (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step));
			}
			/**
			* Check a string against a decoded UTF-16 length limit without materializing it.
			* @param key - argument name.
			* @param maxLength - decoded UTF-16 limit, floored to at least zero.
			* @returns whether the string is longer than the limit; false when absent or not a string.
			*/
			stringExceeds(key, maxLength) {
				const limit = Math.max(0, Math.floor(maxLength));
				return this.remember(`exceeds:${limit}`, key, () => (this.lengthNow(key, limit + 1) ?? 0) > limit);
			}
			/**
			* Read a decoded string, including a streaming prefix.
			* @param key - argument name.
			* @returns the string field's decoded text so far; undefined when absent or not a string.
			*/
			text(key) {
				return this.remember("text", key, () => this.textNow(key));
			}
			/**
			* Read at most the first decoded UTF-16 units of a string.
			* @param key - argument name.
			* @param maxLength - maximum decoded UTF-16 length, floored to at least one.
			* @returns the bounded string prefix; undefined when absent or not a string.
			*/
			textPrefix(key, maxLength) {
				const limit = Math.max(1, Math.floor(maxLength));
				return this.remember(`prefix:${limit}`, key, () => this.textPrefixNow(key, limit));
			}
			/**
			* Read a completed non-string argument.
			* @param key - argument name.
			* @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
			*/
			value(key) {
				return this.remember("value", key, () => this.valueNow(key));
			}
			/** Answer a question and, on a streaming view, remember it for change detection. */
			remember(kind, key, read, comparison) {
				this.scan();
				const result = read();
				if (!this.sealed) {
					const id = `${kind}/${key}`;
					if (!this.#reads.has(id)) this.#reads.set(id, {
						completion: kind === "complete",
						answer: comparison === void 0 ? read : () => comparison(read()),
						last: comparison === void 0 ? result : comparison(result)
					});
				}
				return result;
			}
			closedNow() {
				return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
			}
			keysNow() {
				return this.object === void 0 ? this.#order : Object.keys(this.object);
			}
			hasNow(key) {
				return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
			}
			completeNow(key) {
				if (this.object !== void 0) return Object.hasOwn(this.object, key);
				const entry = this.#entries.get(key);
				return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
			}
			lengthNow(key, limit = Number.POSITIVE_INFINITY) {
				if (this.object !== void 0) {
					const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
					return typeof field === "string" ? field.length : void 0;
				}
				const entry = this.#entries.get(key);
				if (entry?.kind !== "string") return void 0;
				if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
				const read = entry.length ??= {
					at: entry.start,
					length: 0,
					text: ""
				};
				this.readString(entry, read, limit, false);
				return read.length;
			}
			textNow(key) {
				if (this.object !== void 0) {
					const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
					return typeof field === "string" ? field : void 0;
				}
				const entry = this.#entries.get(key);
				if (entry?.kind !== "string") return void 0;
				if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
					let text;
					try {
						text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
					} catch (_error) {}
					if (text !== void 0) entry.text = {
						at: entry.end,
						length: text.length,
						text
					};
				}
				const read = entry.text ??= {
					at: entry.start,
					length: 0,
					text: ""
				};
				this.readString(entry, read, Number.POSITIVE_INFINITY, true);
				return read.text;
			}
			textPrefixNow(key, maxLength) {
				if (this.object !== void 0) {
					const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
					return typeof field === "string" ? field.slice(0, maxLength) : void 0;
				}
				const entry = this.#entries.get(key);
				if (entry?.kind !== "string") return void 0;
				const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
				let read = prefixes.get(maxLength);
				if (read === void 0) {
					read = {
						at: entry.start,
						length: 0,
						text: ""
					};
					prefixes.set(maxLength, read);
				}
				this.readString(entry, read, maxLength, true);
				return read.text;
			}
			valueNow(key) {
				if (this.object !== void 0) {
					if (!Object.hasOwn(this.object, key)) return void 0;
					const field = this.object[key];
					return typeof field === "string" ? void 0 : field;
				}
				const entry = this.#entries.get(key);
				if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
				if (entry.parsed === void 0) try {
					entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
				} catch (_error) {
					entry.invalid = true;
					this.#invalidValue = true;
				}
				return entry.parsed;
			}
			chunkAt(at) {
				let low = 0;
				let high = this.#ends.length;
				while (low < high) {
					const mid = low + high >>> 1;
					if (this.#ends[mid] <= at) low = mid + 1;
					else high = mid;
				}
				return low;
			}
			/** Materialize only a requested range, never the cumulative source. */
			slice(start, end) {
				if (start >= end) return "";
				const first = this.chunkAt(start);
				const last = this.chunkAt(end - 1);
				const base = first === 0 ? 0 : this.#ends[first - 1];
				if (first === last) return this.chunks[first].slice(start - base, end - base);
				const parts = [this.chunks[first].slice(start - base)];
				for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
				parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
				return parts.join("");
			}
			readString(entry, read, limit, materialize) {
				const end = Math.min(entry.end < 0 ? this.#consumed : entry.end, entry.invalidAt ?? Number.POSITIVE_INFINITY, this.#invalidAt ?? Number.POSITIVE_INFINITY);
				if (!entry.needsDecoding) {
					const length = Math.min(end - read.at, limit - read.length);
					if (length <= 0) return;
					if (materialize) read.text += this.slice(read.at, read.at + length);
					read.at += length;
					read.length += length;
					return;
				}
				let chunkIndex = this.chunkAt(read.at);
				while (read.at < end && read.length < limit) {
					const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
					const chunk = this.chunks[chunkIndex];
					const remaining = chunk.slice(read.at - base, Math.min(chunk.length, end - base));
					const boundary = remaining.search(CONTENT_ESCAPE);
					const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read.length);
					if (length > 0) {
						if (materialize) read.text += remaining.slice(0, length);
						read.at += length;
						read.length += length;
						if (read.at === base + chunk.length) chunkIndex++;
						continue;
					}
					const type = remaining.length > 1 ? remaining[1] : read.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
					let decoded;
					let width = 2;
					if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
					if (remaining[0] === "\\" && type === "u") {
						const hex = this.slice(read.at + 2, Math.min(end, read.at + 6));
						let valid = true;
						for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
						if (valid) {
							if (hex.length < 4 && entry.end < 0) return;
							if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
						}
						width = 6;
					} else if (remaining[0] === "\\" && type !== void 0) decoded = SIMPLE_ESCAPES[type];
					if (decoded === void 0) {
						entry.invalidAt = read.at;
						this.#invalidValue = true;
						return;
					}
					if (materialize) read.text += decoded;
					read.length++;
					read.at += width;
					while (chunkIndex < this.chunks.length && read.at >= this.#ends[chunkIndex]) chunkIndex++;
				}
			}
			/** Locate new field ranges without decoding or parsing their contents. */
			scan() {
				if (this.object !== void 0 || this.#consumed === this.#size) return;
				for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
					const pending = this.chunks[i];
					const base = i === 0 ? 0 : this.#ends[i - 1];
					for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
						if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
							const end = this.stringBoundary(pending, index);
							this.#consumed += end - index;
							index = end;
							if (index === pending.length) break;
						}
						this.step(pending[index], this.#consumed);
						this.#consumed++;
					}
				}
			}
			/** Only raw quotes and their preceding backslash runs can terminate a string. */
			stringBoundary(fragment, start) {
				let at = start;
				while (true) {
					const quote = fragment.indexOf("\"", at);
					const end = quote < 0 ? fragment.length : quote;
					if (this.#mode === "string") {
						const entry = this.#current;
						if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
					}
					let slashStart = end;
					while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
					const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
					this.#escape = quote < 0 && escaped;
					if (quote < 0 || !escaped) return end;
					at = quote + 1;
				}
			}
			step(c, at) {
				switch (this.#mode) {
					case "root":
						if (isWhitespace(c)) return;
						if (c === "{") {
							this.#mode = "key-or-end";
							return;
						}
						this.fail();
						return;
					case "key-or-end":
						if (isWhitespace(c)) return;
						if (c === "}") {
							this.#mode = "closed";
							return;
						}
						if (c === "\"") {
							this.beginKey(at);
							return;
						}
						this.fail();
						return;
					case "key-only":
						if (isWhitespace(c)) return;
						if (c === "\"") {
							this.beginKey(at);
							return;
						}
						this.fail();
						return;
					case "key":
						this.stepKey(c, at);
						return;
					case "colon":
						if (isWhitespace(c)) return;
						if (c === ":") {
							this.#mode = "value";
							return;
						}
						this.fail();
						return;
					case "value":
						this.beginValue(c, at);
						return;
					case "string": {
						const entry = this.#current;
						entry.end = at;
						this.#current = null;
						this.#mode = "comma-or-end";
						return;
					}
					case "scalar":
						this.stepScalar(c, at);
						return;
					case "nested":
						this.stepNested(c, at);
						return;
					case "comma-or-end":
						if (isWhitespace(c)) return;
						if (c === ",") {
							this.#mode = "key-only";
							return;
						}
						if (c === "}") {
							this.#mode = "closed";
							return;
						}
						this.fail();
						return;
					case "closed":
						if (isWhitespace(c)) return;
						this.fail();
						return;
					/* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
					case "invalid": return;
					/* v8 ignore next 2 -- Every scanner mode has a handler above. */
					default: assertNever(this.#mode);
				}
			}
			fail() {
				this.#invalidAt = this.#consumed;
				this.#mode = "invalid";
				this.#current = null;
			}
			beginKey(at) {
				this.#mode = "key";
				this.#keyStart = at + 1;
				this.#keyEscaped = false;
				this.#escape = false;
			}
			stepKey(c, at) {
				if (c < " ") {
					this.fail();
					return;
				}
				if (this.#escape) {
					this.#escape = false;
					return;
				}
				if (c === "\\") {
					this.#escape = true;
					this.#keyEscaped = true;
					return;
				}
				if (c !== "\"") return;
				const raw = this.slice(this.#keyStart, at);
				if (this.#keyEscaped) try {
					this.#key = JSON.parse(`"${raw}"`);
				} catch (_error) {
					this.fail();
					return;
				}
				else this.#key = raw;
				this.#mode = "colon";
			}
			open(entry) {
				if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
				this.#entries.set(this.#key, entry);
				this.#current = entry;
			}
			beginValue(c, at) {
				if (isWhitespace(c)) return;
				if (c === "\"") {
					this.open({
						kind: "string",
						start: at + 1,
						end: -1,
						needsDecoding: false,
						invalidAt: void 0,
						length: void 0,
						text: void 0,
						prefixes: void 0
					});
					this.#escape = false;
					this.#mode = "string";
					return;
				}
				if (c === "}" || c === "," || c === ":" || c === "]") {
					this.fail();
					return;
				}
				this.open({
					kind: "value",
					start: at,
					end: -1,
					parsed: void 0,
					invalid: false
				});
				if (c === "{" || c === "[") {
					this.#mode = "nested";
					this.#nestedEnds = [c === "{" ? "}" : "]"];
					this.#nestedInString = false;
					this.#escape = false;
					return;
				}
				this.#mode = "scalar";
			}
			stepScalar(c, at) {
				if (c !== "," && c !== "}" && !isWhitespace(c)) return;
				this.closeValue(at);
				this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
			}
			stepNested(c, at) {
				if (this.#nestedInString) {
					this.#nestedInString = false;
					return;
				}
				if (c === "\"") {
					this.#nestedInString = true;
					return;
				}
				if (c === "{" || c === "[") {
					this.#nestedEnds.push(c === "{" ? "}" : "]");
					return;
				}
				if (c === "}" || c === "]") {
					if (this.#nestedEnds.pop() !== c) {
						this.fail();
						return;
					}
					if (this.#nestedEnds.length === 0) {
						this.closeValue(at + 1);
						this.#mode = "comma-or-end";
					}
				}
			}
			closeValue(end) {
				const entry = this.#current;
				entry.end = end;
				this.#current = null;
			}
		});
		/** Duplicate-install-safe JSON and immutable-value helpers. @module @deepseek-ai/dsh-util-values */
		/**
		* Mark an unreachable closed-union branch.
		* @param value - impossible value; an unhandled typed variant fails at the call site.
		* @param context - optional switch-site label included in the failure message.
		* @returns never; a runtime value that escaped its type always throws.
		*/
		function assertNever(value, context) {
			const rendered = JSON.stringify(value) ?? String(value);
			throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
		}
		/** Whether a realm-owned intrinsic prototype has a native constructor matching this engine's representation. */
		function hasIntrinsicConstructor(prototype, name) {
			const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
			if (typeof constructor !== "function") return false;
			try {
				return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name === "Array" ? Array : Object);
			} catch {
				return false;
			}
		}
		/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
		function isIntrinsicObjectPrototype(value) {
			return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
		}
		/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
		function hasPlainArrayPrototype(value) {
			const prototype = Object.getPrototypeOf(value);
			if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
			const objectPrototype = Object.getPrototypeOf(prototype);
			return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
		}
		/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
		function hasPlainObjectPrototype(value) {
			const prototype = Object.getPrototypeOf(value);
			return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
		}
		/** Return every JSON-visible object key, or reject own data JSON would discard. */
		function enumerableStringKeys(value) {
			const keys = Reflect.ownKeys(value);
			if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
			return keys;
		}
		/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */
		function walkJsonValue(value, detach) {
			const ancestors = /* @__PURE__ */ new Set();
			let root;
			const assign = (destination, item) => {
				if (destination === void 0) return;
				if (destination.kind === "root") root = item;
				else if (destination.kind === "array") destination.target[destination.index] = item;
				else Object.defineProperty(destination.target, destination.key, {
					value: item,
					enumerable: true,
					configurable: true,
					writable: true
				});
			};
			const tasks = [{
				kind: "visit",
				value,
				...detach ? { destination: { kind: "root" } } : {}
			}];
			for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
				if (task.kind === "leave") {
					ancestors.delete(task.source);
					continue;
				}
				if (task.kind === "array-item") {
					if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
					tasks.push({
						kind: "visit",
						value: task.source[task.index],
						...task.target === void 0 ? {} : { destination: {
							kind: "array",
							target: task.target,
							index: task.index
						} }
					});
					continue;
				}
				if (task.kind === "object-property") {
					tasks.push({
						kind: "visit",
						value: task.source[task.key],
						...task.target === void 0 ? {} : { destination: {
							kind: "object",
							target: task.target,
							key: task.key
						} }
					});
					continue;
				}
				const current = task.value;
				if (current === null) {
					assign(task.destination, null);
					continue;
				}
				if (typeof current === "boolean" || typeof current === "string") {
					assign(task.destination, current);
					continue;
				}
				if (typeof current === "number") {
					if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
					assign(task.destination, current);
					continue;
				}
				if (typeof current !== "object") return void 0;
				if (ancestors.has(current)) return void 0;
				if (Array.isArray(current)) {
					if (!hasPlainArrayPrototype(current)) return void 0;
					const length = current.length;
					if (Reflect.ownKeys(current).length !== length + 1) return void 0;
					const target = detach ? [] : void 0;
					if (target !== void 0) assign(task.destination, target);
					ancestors.add(current);
					tasks.push({
						kind: "leave",
						source: current
					});
					for (let index = length - 1; index >= 0; index--) tasks.push({
						kind: "array-item",
						source: current,
						index,
						...target === void 0 ? {} : { target }
					});
					continue;
				}
				if (!hasPlainObjectPrototype(current)) return void 0;
				const keys = enumerableStringKeys(current);
				if (keys === void 0) return void 0;
				const target = detach ? {} : void 0;
				if (target !== void 0) assign(task.destination, target);
				ancestors.add(current);
				tasks.push({
					kind: "leave",
					source: current
				});
				for (let index = keys.length - 1; index >= 0; index--) {
					const key = keys[index];
					/* v8 ignore next -- the loop is bounded by the captured key count. */
					if (key === void 0) return void 0;
					tasks.push({
						kind: "object-property",
						source: current,
						key,
						...target === void 0 ? {} : { target }
					});
				}
			}
			return detach ? root : true;
		}
		/**
		* Validate and detach lossless JSON in one read per property.
		* @param value - candidate value to validate and detach.
		* @returns the detached snapshot, or `undefined` when the value is not losslessly JSON-serializable.
		*/
		function snapshotJsonValue(value) {
			return walkJsonValue(value, true);
		}
		/**
		* Deep-freeze an object graph in place while leaving live AbortSignal objects mutable.
		* @param value - value to freeze.
		* @returns the same value after every reachable enumerable child is frozen.
		*/
		function deepFreeze(value) {
			const seen = /* @__PURE__ */ new WeakSet();
			const pending = [{
				kind: "visit",
				node: value
			}];
			while (pending.length > 0) {
				const task = pending.pop();
				/* v8 ignore next -- the loop condition guarantees one pending task. */
				if (task === void 0) continue;
				if (task.kind === "property") {
					pending.push({
						kind: "visit",
						node: task.source[task.key]
					});
					continue;
				}
				const node = task.node;
				if (node === null || typeof node !== "object") continue;
				if (node instanceof AbortSignal) continue;
				if (seen.has(node)) continue;
				seen.add(node);
				Object.freeze(node);
				const keys = Object.keys(node);
				for (let index = keys.length - 1; index >= 0; index--) {
					const key = keys[index];
					/* v8 ignore next -- the loop is bounded by the captured key count. */
					if (key === void 0) continue;
					pending.push({
						kind: "property",
						source: node,
						key
					});
				}
			}
			return value;
		}
		//#endregion
		//#region lib/types/client/sessions/lineage.js
		/**
		* Summaries -> flat list with lineage indentation. Root and sibling order
		* follows the established input order; this projection never re-sorts a
		* hydrated list from mutable timestamps.
		* @param summaries - the host's session.list items.
		* @returns display rows in render order.
		*/
		function flattenLineage(summaries) {
			const byId = /* @__PURE__ */ new Map();
			for (const s of summaries) byId.set(s.sessionId, s);
			const children = /* @__PURE__ */ new Map();
			const roots = [];
			for (const s of summaries) if (s.parentSessionId !== void 0 && byId.has(s.parentSessionId)) {
				const list = children.get(s.parentSessionId) ?? [];
				list.push(s);
				children.set(s.parentSessionId, list);
			} else roots.push(s);
			const out = [];
			const visited = /* @__PURE__ */ new Set();
			const walk = (s, depth) => {
				if (visited.has(s.sessionId)) {
					console.warn(`[session-controller] lineage cycle at ${s.sessionId}; emitting as root`);
					return;
				}
				visited.add(s.sessionId);
				const { agentAvailable: _agentAvailable, ...row } = s;
				out.push({
					...row,
					depth
				});
				const kids = children.get(s.sessionId);
				if (kids === void 0) return;
				for (const kid of kids) walk(kid, depth + 1);
			};
			for (const root of roots) walk(root, 0);
			for (const s of summaries) if (!visited.has(s.sessionId)) walk(s, 0);
			return out;
		}
		//#endregion
		//#region lib/types/client/sessions/notifier.js
		/**
		* Batches structural updates in microtasks and stream updates by animation
		* frame. Reads may rebuild a dirty snapshot without consuming the pending
		* subscriber notification.
		*/
		var Notifier = class {
			rebuild;
			listeners = /* @__PURE__ */ new Set();
			dirty = false;
			notifyPending = false;
			scheduled = "none";
			scheduleGeneration = 0;
			/** @param rebuild - snapshot rebuild function injected by the owner (writes the owner's snapshotCache). */
			constructor(rebuild) {
				this.rebuild = rebuild;
			}
			/**
			* uSES subscription entry.
			* @param listener - change callback.
			* @returns the unsubscribe function.
			*/
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/** Mark the snapshot dirty and notify in a microtask. */
			markDirty() {
				this.dirty = true;
				this.notifyPending = true;
				if (this.scheduled === "microtask") return;
				this.schedule("microtask");
			}
			/** Mark the snapshot dirty and publish cumulative state at most once per frame. */
			markFrameDirty() {
				this.dirty = true;
				this.notifyPending = true;
				if (this.scheduled !== "none") return;
				this.schedule(typeof globalThis.requestAnimationFrame === "function" ? "frame" : "microtask");
			}
			/**
			* Synchronous flush: controlled-input writes must notify in the same tick as
			* onChange, or React rolls the DOM back to the stale value and the caret jumps to the end.
			*/
			notifyNow() {
				this.dirty = true;
				this.notifyPending = true;
				this.invalidateSchedule();
				this.flush();
			}
			/**
			* Pre-getSnapshot check: rebuild synchronously when dirty (read path
			* before first subscribe / while unobserved). Notification stays pending.
			*/
			ensureFresh() {
				if (!this.dirty) return;
				this.dirty = false;
				this.rebuild();
			}
			schedule(kind) {
				const generation = ++this.scheduleGeneration;
				this.scheduled = kind;
				const publish = () => {
					if (generation !== this.scheduleGeneration) return;
					this.scheduled = "none";
					this.flush();
				};
				if (kind === "frame") globalThis.requestAnimationFrame(publish);
				else queueMicrotask(publish);
			}
			invalidateSchedule() {
				this.scheduleGeneration++;
				this.scheduled = "none";
			}
			flush() {
				if (!this.notifyPending) return;
				if (this.listeners.size === 0) return;
				this.notifyPending = false;
				if (this.dirty) {
					this.dirty = false;
					this.rebuild();
				}
				(0, _deepseek_ai_dsh_client_store.notifySubscribers)(this.listeners, "[session-controller]");
			}
		};
		//#endregion
		//#region lib/types/client/sessions/projection-store.js
		/**
		* One session's projection values. Framework semantics, uniform across every
		* key. Sequenced writes (a baseline seeds rows at its cut, a push frame
		* updates one row) compare seqs among themselves: a lower-or-equal seq within
		* the Host generation loses, so a replayed frame cannot regress a value and a
		* stale baseline cannot overwrite a newer frame. Cached writes (the session
		* list's zero-I/O block) only fill keys no sequenced row holds, and a baseline
		* discards every cached row before it seeds, regardless of seq: the connected
		* Session is the truth and a cached value never outranks it. A key the store
		* has never seen reads `undefined` (capability absent). Faces are identity-stable
		* per key (create-on-demand, cached) so the React side binds each exactly
		* once; the store-level channel (`subscribeAny`) serves coarse consumers (the
		* manager's list projection reads the `title` key).
		*/
		var ProjectionValueStore = class {
			rows = /* @__PURE__ */ new Map();
			channels = /* @__PURE__ */ new Map();
			valuesCache;
			/** Coarse any-key channel (no snapshot cache to rebuild: reads hit rows directly). */
			anyNotifier = new Notifier(() => {});
			/**
			* Key-addressed bare observable face (the useProjection resolution path).
			* Always defined — absence is an `undefined` snapshot, never a missing
			* face, so a component may subscribe before the key ever carries a value.
			* @param key - projection key.
			* @returns the identity-stable face for this key.
			*/
			faceOf(key) {
				return this.channel(key).face;
			}
			/**
			* Current whole value for a key (erased framework read; typed reads go
			* through `useProjection`'s map lookup).
			* @param key - projection key.
			* @returns the value, or undefined while the key is absent.
			*/
			get(key) {
				return this.rows.get(key)?.value;
			}
			/**
			* Read the accepted Host watermark without subscribing or copying a value.
			* @param key - projection key.
			* @returns the current sequence, or undefined for absent and cached values.
			*/
			seqOf(key) {
				const row = this.rows.get(key);
				return row?.kind === "sequenced" ? row.seq : void 0;
			}
			/**
			* Read every current projection value as one reference-stable snapshot.
			* @returns The same frozen value map until a row changes.
			*/
			values() {
				if (this.valuesCache === void 0) this.valuesCache = Object.freeze(Object.fromEntries([...this.rows].map(([key, row]) => [key, row.value])));
				return this.valuesCache;
			}
			/**
			* Subscribe to any-key changes (microtask-batched) — the manager's list
			* rebuild channel.
			* @param listener - change callback.
			* @returns the unsubscribe function.
			*/
			subscribeAny(listener) {
				return this.anyNotifier.subscribe(listener);
			}
			/**
			* Apply one finished value from the Session control stream.
			* @param key - projection key.
			* @param value - whole value computed by the host unit.
			* @param seq - the unit's watermark at emission.
			*/
			apply(key, value, seq) {
				const row = this.rows.get(key);
				if (row?.kind === "sequenced" && seq <= row.seq) return;
				this.rows.set(key, {
					kind: "sequenced",
					value,
					seq
				});
				this.changed(key);
			}
			/**
			* Fill keys from a session-list block the Host labeled `cached`: a zero-I/O
			* view of the persisted checkpoint. A cached value lands only where no
			* sequenced row exists: a connected Session has already answered for such
			* a key, and the list's view of the persisted checkpoint cannot be newer
			* than it.
			* @param values - whole values by key viewed from the persisted checkpoint.
			*/
			applyCached(values) {
				for (const key of Object.keys(values)) {
					if (this.rows.get(key)?.kind === "sequenced") continue;
					this.rows.set(key, {
						kind: "cached",
						value: values[key]
					});
					this.changed(key);
				}
			}
			/**
			* Seed from a history tail page's projections block. Every cached row is
			* discarded first, regardless of seq: the block comes from the connected
			* Session, and a value viewed from the persisted checkpoint never outranks
			* it. Then every carried key lands under the same seq rule as frames, and a
			* key the block omits is capability-absent as of the cut — its row clears
			* unless a newer frame already superseded the cut (a stale baseline can
			* neither overwrite nor clear newer sequenced values).
			* @param baseline - the response's projections block.
			*/
			seed(baseline) {
				for (const [key, row] of this.rows) {
					if (row.kind !== "cached") continue;
					this.rows.delete(key);
					this.changed(key);
				}
				const values = baseline.values;
				for (const key of Object.keys(values)) this.apply(key, values[key], baseline.asOfSeq);
				for (const [key, row] of this.rows) {
					if (Object.hasOwn(values, key)) continue;
					if (row.kind === "sequenced" && row.seq > baseline.asOfSeq) continue;
					this.rows.delete(key);
					this.changed(key);
				}
			}
			/** Discard one Host generation's values and watermarks while preserving subscribed faces. */
			clear() {
				for (const key of this.rows.keys()) {
					this.rows.delete(key);
					this.changed(key);
				}
			}
			changed(key) {
				this.valuesCache = void 0;
				this.channels.get(key)?.notifier.markDirty();
				this.anyNotifier.markDirty();
			}
			channel(key) {
				let channel = this.channels.get(key);
				if (channel === void 0) {
					const notifier = new Notifier(() => {});
					channel = {
						notifier,
						face: {
							getSnapshot: () => this.rows.get(key)?.value,
							subscribe: (listener) => notifier.subscribe(listener)
						}
					};
					this.channels.set(key, channel);
				}
				return channel;
			}
		};
		//#endregion
		//#region ../../util/crypto/lib/index.js
		/**
		* Random v4 UUID, minted from `crypto.getRandomValues`.
		* @returns the UUID string.
		*/
		function randomUUID() {
			const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
			const hex = Array.from(bytes, (byte, index) => {
				return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
			}).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
		//#endregion
		//#region lib/types/client/contract/events.js
		/** Observable contiguous Session event window consumed by domain assemblers. */
		function leaf(entries) {
			return {
				kind: "leaf",
				entries,
				length: entries.length
			};
		}
		function concat(left, right) {
			return {
				kind: "concat",
				left,
				right,
				length: left.length + right.length
			};
		}
		function materialize(node) {
			if (node.kind === "leaf") return node.entries;
			const entries = new Array(node.length);
			const pending = [node];
			let index = 0;
			while (pending.length > 0) {
				const current = pending.pop();
				if (current.kind === "concat") {
					pending.push(current.right, current.left);
					continue;
				}
				for (const entry of current.entries) {
					entries[index] = entry;
					index += 1;
				}
			}
			return entries;
		}
		function windowSnapshot(node, hasMore, revision, change) {
			let entries;
			return {
				get entries() {
					entries ??= materialize(node);
					return entries;
				},
				hasMore,
				revision,
				change
			};
		}
		/** Session-owned event feed; every accepted window mutation publishes synchronously. */
		var MutableSessionEventSource = class {
			listeners = /* @__PURE__ */ new Set();
			window = leaf([]);
			snapshot = windowSnapshot(this.window, false, 0, {
				kind: "replace",
				entries: []
			});
			/** @returns the cached event-window snapshot. */
			getSnapshot() {
				return this.snapshot;
			}
			/**
			* Subscribe to synchronous window publication.
			* @param listener - invalidation callback.
			* @returns unsubscribe function.
			*/
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/**
			* Replace the complete contiguous window.
			* @param entries - complete window.
			* @param hasMore - whether older history remains.
			*/
			replace(entries, hasMore) {
				this.window = leaf(entries);
				this.publish(hasMore, {
					kind: "replace",
					entries
				});
			}
			/**
			* Prepend one older contiguous page.
			* @param entries - newly loaded older entries.
			* @param hasMore - whether still older history remains.
			*/
			prepend(entries, hasMore) {
				this.window = concat(leaf(entries), this.window);
				this.publish(hasMore, {
					kind: "prepend",
					entries
				});
			}
			/**
			* Append one contiguous live entry.
			* @param entry - live tail entry.
			*/
			append(entry) {
				const entries = [entry];
				this.window = concat(this.window, leaf(entries));
				this.publish(this.snapshot.hasMore, {
					kind: "append",
					entries
				});
			}
			/**
			* Replace one attempt's transient rows with its committed durable settlement.
			* @param attemptId - process-local attempt whose live rows are now redundant.
			* @param entry - durable settlement committed for that attempt.
			*/
			settleAssistant(attemptId, entry) {
				const entries = materialize(this.window).filter((candidate) => candidate.type !== "transient" || candidate.event.data.attemptId !== attemptId);
				if (entry !== void 0) {
					const index = entries.findIndex((candidate) => candidate.event.seq > entry.event.seq);
					if (index < 0) entries.push(entry);
					else entries.splice(index, 0, entry);
				}
				this.window = leaf(entries);
				this.publish(this.snapshot.hasMore, {
					kind: "settle-assistant",
					attemptId,
					...entry === void 0 ? {} : { entry }
				});
			}
			publish(hasMore, change) {
				this.snapshot = windowSnapshot(this.window, hasMore, this.snapshot.revision + 1, change);
				(0, _deepseek_ai_dsh_client_store.notifySubscribers)(this.listeners, "[session-controller] event feed");
			}
		};
		//#endregion
		//#region lib/types/client/time-zone.js
		/** Browser-owned time-zone sampling for one prompt RPC. */
		/**
		* Resolve the current browser IANA zone for one outbound operation.
		* @returns The browser-provided canonical zone.
		* @throws when the runtime cannot provide a non-empty zone.
		*/
		function resolvedClientTimeZone() {
			const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
			if (typeof timeZone !== "string" || timeZone.length === 0) throw new Error("browser time zone is unavailable");
			return timeZone;
		}
		//#endregion
		//#region ../../llm/llm/lib/types/assistant-stream.js
		/**
		* Lossless compact representation of one model-stream attempt, plus record-level
		* readers that answer common consumer questions without materializing members.
		* Readers trust the static record type; expandAssistantStream is the validating
		* path for records read at a durable boundary.
		*/
		function safeTime(value) {
			if (!Number.isSafeInteger(value)) throw new TypeError(`Assistant stream time must be a safe integer, got ${String(value)}`);
			return value;
		}
		function safeIndex(value, label) {
			if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`${label} index must be a non-negative safe integer`);
			return value;
		}
		function snapshotChunk(chunk) {
			const snapshot = snapshotJsonValue(chunk);
			if (snapshot === void 0) throw new TypeError("Assistant stream chunk must be losslessly JSON-serializable");
			return snapshot;
		}
		/**
		* Expand compact records into the exact timed chunk sequence.
		* @param stream - compact records from one durable Assistant settlement.
		* @returns detached timed chunks with every original delta boundary preserved.
		* @throws {TypeError} when a record or reconstructed timestamp is invalid.
		*/
		function expandAssistantStream(stream) {
			const chunks = [];
			for (const candidate of stream) {
				const record = validateRecord(candidate);
				if (record.type === "chunk") {
					chunks.push({
						time: record.time,
						chunk: record.chunk
					});
					continue;
				}
				const members = record.type === "tool-call-chunks" ? record.args : record.texts;
				let time = record.time0;
				for (let index = 0; index < members.length; index += 1) {
					if (index > 0) time += record.dt[index - 1];
					let chunk;
					if (record.type === "text-chunks") chunk = {
						type: "text-delta",
						index: record.index,
						text: members[index]
					};
					else if (record.type === "reasoning-chunks") chunk = {
						type: "reasoning-delta",
						index: record.index,
						text: members[index]
					};
					else chunk = {
						type: "tool-call-delta",
						index: record.index,
						id: record.id,
						...Object.hasOwn(record, "name") ? { name: record.name } : {},
						argumentsDelta: members[index]
					};
					chunks.push({
						time,
						chunk
					});
				}
			}
			return chunks;
		}
		function validateRecord(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Assistant stream record must be an object");
			const record = value;
			switch (record.type) {
				case "text-chunks":
				case "reasoning-chunks": {
					exactKeys(record, [
						"type",
						"time0",
						"index",
						"dt",
						"texts"
					], record.type);
					const texts = stringArray(record.texts, `${record.type} texts`);
					if (texts.length === 0) throw new TypeError(`${record.type} texts must be non-empty`);
					validateRun(record, texts.length, record.type);
					return record;
				}
				case "tool-call-chunks": {
					exactKeys(record, Object.hasOwn(record, "name") ? [
						"type",
						"time0",
						"index",
						"dt",
						"id",
						"name",
						"args"
					] : [
						"type",
						"time0",
						"index",
						"dt",
						"id",
						"args"
					], record.type);
					const args = stringArray(record.args, "tool-call-chunks args");
					if (args.length === 0) throw new TypeError("tool-call-chunks args must be non-empty");
					if (typeof record.id !== "string" || record.id.length === 0) throw new TypeError("tool-call-chunks id must be a non-empty string");
					if (record.name !== void 0 && (typeof record.name !== "string" || record.name.length === 0)) throw new TypeError("tool-call-chunks name must be a non-empty string");
					validateRun(record, args.length, record.type);
					return record;
				}
				case "chunk": {
					exactKeys(record, [
						"type",
						"time",
						"chunk"
					], "chunk");
					const time = safeTime(record.time);
					if (typeof record.chunk !== "object" || record.chunk === null || Array.isArray(record.chunk)) throw new TypeError("Assistant stream raw chunk must be a lossless JSON object");
					let chunk;
					try {
						chunk = snapshotChunk(record.chunk);
					} catch (error) {
						throw new TypeError("Assistant stream raw chunk must be a lossless JSON object", { cause: error });
					}
					return deepFreeze({
						type: "chunk",
						time,
						chunk
					});
				}
				default: throw new TypeError(`Unsupported Assistant stream record ${JSON.stringify(record.type)}`);
			}
		}
		function validateRun(record, members, label) {
			safeTime(record.time0);
			safeIndex(record.index, label);
			if (!Array.isArray(record.dt) || record.dt.some((value) => !Number.isSafeInteger(value))) throw new TypeError(`${label} dt must contain safe integers`);
			if (record.dt.length !== members - 1) throw new TypeError(`${label} dt length must be one less than its members`);
			let time = record.time0;
			for (const gap of record.dt) {
				time += gap;
				if (!Number.isSafeInteger(time)) throw new TypeError(`${label} member times must stay safe integers`);
			}
		}
		function stringArray(value, label) {
			if (!Array.isArray(value) || value.some((member) => typeof member !== "string")) throw new TypeError(`${label} must be a string array`);
			return value;
		}
		function exactKeys(record, keys, label) {
			if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) throw new TypeError(`${label} Assistant stream record must contain exactly ${keys.join(", ")}`);
		}
		//#endregion
		//#region lib/types/client/sessions/assistant-stream.js
		/** Web presentation fold joining transient Assistant frames to one durable v2 settlement. */
		/** Keeps transient Assistant presentation behind one settlement-aware interface. */
		var ClientAssistantStream = class {
			activeAttempt;
			retainedAttempt;
			pending = /* @__PURE__ */ new Map();
			publishedSeqs = /* @__PURE__ */ new Set();
			durableCursor = -1;
			transientInGap = 0;
			/**
			* Replace the durable Web window and adopt an optional reconnect baseline.
			* @param entries - durable entries in the replacement window.
			* @param baseline - compact prefix for an Assistant attempt that is still live.
			* @returns immediately visible durable entries plus reconstructed transient chunks.
			*/
			replace(entries, baseline) {
				this.pending.clear();
				this.transientInGap = 0;
				this.activeAttempt = void 0;
				this.retainedAttempt = void 0;
				const opening = baseline?.activeAttempt;
				if (opening !== void 0) this.activeAttempt = {
					attemptId: opening.attemptId,
					startedAfterSeq: opening.startedAfterSeq,
					turn: opening.turn,
					step: opening.step,
					nextIndex: opening.nextIndex
				};
				const visible = [...entries];
				this.publishedSeqs = new Set(visible.map((entry) => entry.event.seq));
				this.durableCursor = visible.reduce((cursor, entry) => Math.max(cursor, entry.event.seq), -1);
				if (opening !== void 0) for (const [index, member] of expandAssistantStream(opening.stream).entries()) {
					this.transientInGap += 1;
					visible.push({
						type: "transient",
						event: {
							type: "assistant/live-chunk",
							seq: this.durableCursor + 1 - 1 / (this.transientInGap + 1),
							time: member.time,
							data: {
								attemptId: opening.attemptId,
								turn: opening.turn,
								step: opening.step,
								chunk: member.chunk
							}
						}
					});
					if (index + 1 >= opening.nextIndex) break;
				}
				return visible;
			}
			/**
			* Stage one durable v2 settlement while its matching live attempt is open.
			* @param entry - newly followed durable entry.
			* @returns a publication decision, or `undefined` when no entry becomes visible.
			*/
			acceptDurable(entry) {
				const event = entry.event;
				this.durableCursor = Math.max(this.durableCursor, event.seq);
				this.transientInGap = 0;
				const settlement = assistantSettlementEntry(entry);
				if (settlement !== void 0 && this.attemptForSettlement(settlement.event) !== void 0) {
					if (this.pending.has(event.seq)) return { type: "rebaseline" };
					this.pending.set(event.seq, settlement);
					return;
				}
				return this.publish(entry);
			}
			/**
			* Fold one dense transient frame and release its named durable settlement.
			* Successful messages retain their transient rows until the owning Step ends;
			* interrupted messages, failed attempts, and abandonment retire them immediately.
			* @param frame - next Assistant stream frame received by the follow connection.
			* @returns a transient, publication, or rebaseline decision, or `undefined` when no entry becomes visible.
			*/
			acceptFrame(frame) {
				switch (frame.type) {
					case "start":
						if (this.activeAttempt !== void 0 || this.retainedAttempt !== void 0 || this.pending.size > 0) return { type: "rebaseline" };
						this.pending.clear();
						this.activeAttempt = {
							attemptId: frame.attemptId,
							startedAfterSeq: frame.startedAfterSeq,
							turn: frame.turn,
							step: frame.step,
							nextIndex: 0
						};
						return;
					case "chunk": {
						const attempt = this.activeAttempt;
						if (attempt === void 0 || attempt.attemptId !== frame.attemptId) return void 0;
						if (frame.index !== attempt.nextIndex) return { type: "rebaseline" };
						attempt.nextIndex += 1;
						this.transientInGap += 1;
						return {
							type: "transient",
							entry: {
								type: "transient",
								event: {
									type: "assistant/live-chunk",
									seq: this.durableCursor + 1 - 1 / (this.transientInGap + 1),
									time: frame.time,
									data: {
										attemptId: frame.attemptId,
										turn: attempt.turn,
										step: attempt.step,
										chunk: frame.chunk
									}
								}
							}
						};
					}
					case "end": {
						const attempt = this.activeAttempt;
						if (attempt === void 0 || attempt.attemptId !== frame.attemptId) return;
						this.activeAttempt = void 0;
						if (frame.index !== attempt.nextIndex) return { type: "rebaseline" };
						if (frame.outcome.kind === "abandoned") return this.pending.size === 0 ? {
							type: "abandonment",
							attemptId: attempt.attemptId
						} : { type: "rebaseline" };
						if (this.publishedSeqs.has(frame.outcome.seq)) return void 0;
						const entry = this.pending.get(frame.outcome.seq);
						if (entry === void 0 || entry.event.type !== frame.outcome.eventType) return { type: "rebaseline" };
						this.pending.delete(frame.outcome.seq);
						if (entry.event.type === "assistant/message" && entry.event.data.interrupted !== true) {
							this.retainedAttempt = {
								attemptId: attempt.attemptId,
								turn: attempt.turn,
								step: attempt.step
							};
							return this.publish(entry);
						}
						this.publishedSeqs.add(entry.event.seq);
						return {
							type: "settlement",
							attemptId: attempt.attemptId,
							entry
						};
					}
				}
			}
			attemptForSettlement(event) {
				const attempt = this.activeAttempt;
				if (attempt === void 0 || event.type === "assistant/message" && event.surfaceOp !== "append" || event.seq <= attempt.startedAfterSeq || attempt.turn !== event.data.turn || attempt.step !== event.data.step) return void 0;
				return attempt;
			}
			publish(entry) {
				this.publishedSeqs.add(entry.event.seq);
				const retained = this.retainedAttempt;
				if (retained !== void 0 && entry.event.type === "step/end" && entry.event.data.turn === retained.turn && entry.event.data.step === retained.step) {
					this.retainedAttempt = void 0;
					return {
						type: "publish",
						entry,
						retireAttemptId: retained.attemptId
					};
				}
				return {
					type: "publish",
					entry
				};
			}
		};
		function assistantSettlementEntry(entry) {
			return entry.event.type === "assistant/message" || entry.event.type === "assistant/attempt" ? entry : void 0;
		}
		//#endregion
		//#region lib/types/client/sessions/session.js
		function projectionsBaseline(value) {
			return {
				...value,
				asOfSeq: value.asOfSeq === -1 ? -1 : SessionSeq(value.asOfSeq)
			};
		}
		const HISTORY_PAGE_OPTIONS = {
			maxMessages: 500,
			turnWindow: {
				minMessages: 50,
				minTurns: 2
			}
		};
		const JUMP_PAGE_OPTIONS = {
			...HISTORY_PAGE_OPTIONS,
			turnWindow: {
				...HISTORY_PAGE_OPTIONS.turnWindow,
				minMessages: 200
			}
		};
		/**
		* Owns a session's event window, lifecycle state, and observable
		* snapshot. React bindings remain outside this data layer. Features see only
		* the {@link SessionFace} slice (ISession verbs + the snapshot source); the
		* remaining public members are Session Controller internals.
		*/
		var Session = class {
			sessionId;
			remote;
			options;
			baseSeq = SessionLogOffset(0);
			hasMore = false;
			openState = "cold";
			openError = null;
			openPromise = null;
			/** Bumped by stream replacement to invalidate an in-flight doOpen. Stale
			*  passes drop all writes once the generation moves on. */
			openGeneration = 0;
			loadingOlder = false;
			/** Shared low-water target of the running jump loop; null when no jump is paging. */
			jumpTargetSeq = null;
			/** The running jump loop's completion, shared by retargeting callers. */
			jumpPromise = null;
			pendingHistory = null;
			stopObservingInbox;
			assistantStream = new ClientAssistantStream();
			running = false;
			address;
			parentAvailable;
			/**
			* Sticky send marker, private input of the composerPhase derivation: set
			* synchronously before prompt()'s first await, never reset — the blank →
			* engaging edge of the phase machine (see ComposerPhase).
			*/
			promptAttempted = false;
			/** A first accepted prompt stays in the engaging phase until its turn is observable. */
			firstPromptPendingTurn = false;
			/** New Session display state; unknown bare sessions begin conservatively blank. */
			blankBit = true;
			removed = false;
			promptError = null;
			lastAgentError = null;
			/** Local submission echoes, insertion-ordered (see SessionSnapshot.pendingSubmissions). */
			pendingSubmissions = [];
			/** Per-echo settlement state; `retiring` latches the first observation so a
			*  Inbox projection and its durable event cannot both retire one echo. */
			submissionSettlements = /* @__PURE__ */ new Map();
			/** Owns the addressed page/follow lifecycle while this Session is open. */
			events;
			/**
			* Per-session projection value store (push model; see the session-projection
			* subsystem page, docs/subsystems/session-projection.md): finished whole
			* values computed on the Host, seeded by the tail page's
			* projections block and updated by Session Controller control frames;
			* Host-sequenced writes merge under higher-seq-wins and cached list blocks
			* yield to them (projection-store.ts). Keys are read via `projections.faceOf(key)`
			* (the useProjection resolution face); the conversation snapshot never
			* carries projection values, and no client-side domain folding exists.
			* Manager-owned when constructed through SessionManager (frames route and
			* the store outlives instantiation, the title-snapshot precedent); a bare
			* construction gets a private store.
			*/
			projections;
			/** Contiguous history and live tail consumed by Conversation assembly. */
			eventSource = new MutableSessionEventSource();
			snapshotCache;
			notifier;
			/**
			* Agent-scoped cordis context, bound once by ClientSessions when it
			* mints the scope (the client mirror of the host Agent's loopCtx). The
			* Session dispatches its own scoped events through it; undefined means
			* unbound (bare object-layer construction) or already pruned — both skip
			* dispatch-dependent behavior rather than fail.
			*/
			actx;
			/**
			* @param sessionId - Host session identity (client sessions are always Host-born).
			* @param remote - generated Remote namespaces this session calls.
			* @param options - optional manager-owned state observers.
			*/
			constructor(sessionId, remote, options = {}) {
				this.sessionId = sessionId;
				this.remote = remote;
				this.options = options;
				this.projections = options.projections ?? new ProjectionValueStore();
				this.address = options.address;
				this.parentAvailable = options.parentAvailable;
				this.notifier = new Notifier(() => {
					this.snapshotCache = this.buildSnapshot();
				});
				this.snapshotCache = this.buildSnapshot();
				this.stopObservingInbox = this.projections.faceOf("inbox").subscribe(() => {
					this.observeSubmissionInbox();
				});
			}
			/**
			* Bind the Agent-scoped context minted by ClientSessions (single write;
			* a second bind is a wiring error and throws). Direction stays one-way at
			* this binding boundary: consumers still reach the Session via `sessions.sessionOf`,
			* while the Session holds its own dispatch point (host Agent.loopCtx
			* mirror).
			* @param actx - the agent's scoped context.
			*/
			bindScope(actx) {
				if (this.actx !== void 0) throw new Error(`session ${this.sessionId} already has a bound scope`);
				this.actx = actx;
			}
			/** Release the bound scope at prune time (a later rebind accompanies a freshly minted scope). */
			unbindScope() {
				this.actx = void 0;
			}
			/**
			* Register one local submission echo (see the ISession declaration).
			* Synchronous through markDirty: the echo is in the very next snapshot, so
			* the conversation can paint it before the caller starts serializing.
			* @param input - echo content and the optional settlement callback.
			* @returns the minted identity for {@link prompt} plus the pre-prompt abandon path.
			*/
			beginSubmission(input) {
				const requestId = randomUUID();
				const placement = this.running ? input.mode === "steer" ? "steering" : "queued" : "transcript";
				this.pendingSubmissions = [...this.pendingSubmissions, {
					requestId,
					placement,
					time: Date.now(),
					text: input.text,
					attachments: input.attachments
				}];
				this.submissionSettlements.set(requestId, {
					placement,
					onRetire: input.onRetire,
					retiring: false
				});
				this.promptAttempted = true;
				this.notifier.markDirty();
				return {
					requestId,
					abandon: () => {
						this.retireFailedSubmission(requestId);
					}
				};
			}
			/**
			* Send (queue/steer passed through 1:1); failures land in the snapshot's promptError.
			* @param content - text, browser-owned temporary image uploads, and staged-file receipts.
			* @param mode - queue appends after the current turn; steer interrupts it.
			* @param signal - optional caller cancellation for the complete admission round-trip.
			* @param requestId - identity from {@link beginSubmission}; a failed identified prompt retires its echo.
			* @returns the prompt result (also mirrored into promptError on failure).
			*/
			async prompt(content, mode, signal, requestId) {
				this.promptError = null;
				this.lastAgentError = null;
				this.promptAttempted = true;
				if (this.blankBit) this.firstPromptPendingTurn = true;
				this.notifier.markDirty();
				let result;
				if (this.address === void 0) {
					const clientTimeZone = resolvedClientTimeZone();
					result = await this.remote.session.prompt({
						requestId: requestId ?? randomUUID(),
						sessionId: this.sessionId,
						mode,
						content,
						clientTimeZone
					}, signal);
				} else if (content.some((part) => part.type === "file")) result = {
					ok: false,
					error: new RemoteError("subagent/attachment-invalid", "subagent continuation does not accept files", { reason: "SUBAGENT_FILE_UNSUPPORTED" })
				};
				else {
					const routedContent = content;
					const routed = await this.remote.subagents.prompt({
						requestId: randomUUID(),
						parentSessionId: this.address.parentSessionId,
						childSessionId: this.address.childSessionId,
						mode: "continuable",
						delivery: mode,
						content: routedContent,
						clientTimeZone: resolvedClientTimeZone()
					}, signal);
					result = routed.ok ? {
						ok: true,
						value: { accepted: true }
					} : routed;
				}
				if (!result.ok) {
					if (requestId !== void 0) this.retireFailedSubmission(requestId);
					this.promptError = {
						op: "send",
						error: result.error
					};
					this.notifier.markDirty();
					return result;
				}
				if (this.blankBit) {
					this.blankBit = false;
					this.notifier.markDirty();
				}
				this.options.onEngaged?.(this);
				return result;
			}
			/**
			* Resolve one image referenced by this session into browser-consumable bytes.
			* @param attachmentId - opaque id found in the folded session log.
			* @returns the authenticated reference and decoded bytes.
			*/
			async readAttachment(attachmentId) {
				const result = await this.remote.session.attachment({
					sessionId: this.sessionId,
					attachmentId
				});
				if (!result.ok) return result;
				const binary = atob(result.value.data);
				const data = Uint8Array.from(binary, (char) => char.charCodeAt(0));
				return {
					ok: true,
					value: {
						attachment: result.value.attachment,
						data
					}
				};
			}
			/** Apply one operation to a still-pending queue occurrence. */
			async updateQueue(itemId, action) {
				return this.remote.session.updateQueue({
					sessionId: this.sessionId,
					itemId,
					action
				});
			}
			/**
			* Stop the active turn while the Host preserves pending inbox work; failures
			* land in promptError (same error-strip display slot). A subagent address
			* routes through `subagents.interruptByParent`, whose durable parent-address
			* authority works without a live parent Agent.
			* @returns the cancel result.
			*/
			async cancel() {
				const address = this.address;
				const result = address !== void 0 ? await this.remote.subagents.interruptByParent(address.childSessionId, address.parentSessionId, "continuable") : await this.remote.session.cancel({ sessionId: this.sessionId });
				if (!result.ok) {
					this.promptError = {
						op: "stop",
						error: result.error
					};
					this.notifier.markDirty();
				}
				return result;
			}
			/**
			* Rename: contract session.rename 1:1. On success settle the 'title'
			* projection cell from the response's `{title, seq}` under the store's
			* higher-seq-wins rule (the push frame arriving later is a no-op replay),
			* so the list row and any useProjection('title') reader update without
			* waiting for the control-stream projection update.
			* @param title - raw title text (the host normalizes acceptance).
			* @returns the rename result (normalized accepted title + title event seq).
			*/
			async rename(title) {
				const result = await this.remote.session.rename({
					sessionId: this.sessionId,
					title
				});
				if (!result.ok) return result;
				const seq = SessionSeq(result.value.seq);
				this.projections.apply("title", result.value.title, seq);
				return {
					ok: true,
					value: {
						title: result.value.title,
						seq
					}
				};
			}
			/**
			* Execute one slash-command line against this session's agent — pure
			* admission semantics (the host executor durably logs the lifecycle;
			* outcomes render as flow nodes, never as a response echo).
			* @param line - the full command line, leading slash included.
			* @returns the admission result.
			*/
			async command(line) {
				const result = await this.remote.commands.execute(this.sessionId, line, []);
				if (!result.ok) return result;
				return {
					ok: true,
					value: { matched: result.value !== void 0 }
				};
			}
			/** First open: pull the tail page (idempotent — in-flight/already-open returns the existing promise). */
			open() {
				if (this.openState === "open") return Promise.resolve();
				if (this.openPromise !== null) return this.openPromise;
				const promise = this.doOpen(this.openGeneration).finally(() => {
					if (this.openPromise === promise) this.openPromise = null;
				});
				this.openPromise = promise;
				return promise;
			}
			/** Prepend one Turn-aligned page: at least 50 messages and two Turn starts, capped at 500 messages. */
			async loadOlder() {
				if (this.openState !== "open" || !this.hasMore || this.loadingOlder) return;
				const events = this.events;
				if (events === void 0) return;
				this.loadingOlder = true;
				this.notifier.markDirty();
				try {
					await events.prepend({
						beforeSeq: this.baseSeq,
						...HISTORY_PAGE_OPTIONS
					});
				} catch (error) {
					if (!(0, _deepseek_ai_dsh_api_gateway_client.isRemoteFailure)(error)) console.error("[session-controller] loadOlder failed:", error);
				} finally {
					this.loadingOlder = false;
					this.notifier.markDirty();
				}
			}
			/** Jump loader: page backwards until the window covers seq (see ISession.loadThrough). */
			loadThrough(seq) {
				if (this.openState !== "open" || !this.hasMore || this.baseSeq <= seq) return Promise.resolve();
				if (this.jumpPromise !== null) {
					this.jumpTargetSeq = SessionSeq(Math.min(this.jumpTargetSeq ?? seq, seq));
					return this.jumpPromise;
				}
				if (this.loadingOlder) return Promise.resolve();
				const events = this.events;
				if (events === void 0) return Promise.resolve();
				const pending = {
					beforeSeq: this.baseSeq,
					hasMore: this.hasMore,
					pages: []
				};
				this.pendingHistory = pending;
				this.jumpTargetSeq = seq;
				this.loadingOlder = true;
				this.notifier.markDirty();
				const generation = this.openGeneration;
				this.jumpPromise = (async () => {
					try {
						while (pending.hasMore && this.jumpTargetSeq !== null && pending.beforeSeq > this.jumpTargetSeq) {
							if (generation !== this.openGeneration) return;
							const before = pending.beforeSeq;
							await events.prepend({
								beforeSeq: before,
								...JUMP_PAGE_OPTIONS
							});
							if (pending.beforeSeq >= before) return;
						}
					} catch (error) {
						if (!(0, _deepseek_ai_dsh_api_gateway_client.isRemoteFailure)(error)) console.error("[session-controller] loadThrough failed:", error);
					} finally {
						this.jumpTargetSeq = null;
						this.jumpPromise = null;
						this.pendingHistory = null;
						this.loadingOlder = false;
						if (generation === this.openGeneration && pending.pages.length > 0) this.prependWindow(pending.pages.reverse().flat(), pending.hasMore);
						this.notifier.markDirty();
					}
				})();
				return this.jumpPromise;
			}
			/** Rebuild an opened history source after address replacement.
			*  Invalidates any in-flight open first; projection state belongs to the independently
			*  reconnecting control stream and remains untouched. */
			async resync() {
				if (this.openState === "cold") return;
				this.openGeneration++;
				const events = this.events;
				this.events = void 0;
				await events?.dispose();
				this.openPromise = null;
				this.openState = "cold";
				this.openError = null;
				this.baseSeq = SessionLogOffset(0);
				this.notifier.markDirty();
				await this.open();
			}
			/**
			* uSES subscription entry.
			* @param listener - change callback.
			* @returns the unsubscribe function.
			*/
			subscribe(listener) {
				return this.notifier.subscribe(listener);
			}
			/**
			* Cached Session snapshot (rebuilt lazily when dirty with no listeners).
			* @returns the cached reference (stable until the next flush).
			*/
			getSnapshot() {
				this.notifier.ensureFresh();
				return this.snapshotCache;
			}
			/**
			* Running-bit relay from the host stream (list entry and snapshot stay consistent).
			* @param running - the new running state.
			*/
			handleRunning(running) {
				if (running && this.blankBit) {
					this.blankBit = false;
					this.notifier.markDirty();
				}
				if (running) this.firstPromptPendingTurn = false;
				if (this.running === running) return;
				this.running = running;
				this.notifier.markDirty();
			}
			/**
			* Install or clear the catalog-discovered transport address. A changed
			* address rebuilds an already-open window through its new history route.
			* @param address - direct parent/child address, or undefined for ordinary transport.
			* @param parentAvailable - latest exact-parent availability hint, or undefined before a catalog read.
			*/
			configureSubagent(address, parentAvailable) {
				const same = this.address?.parentSessionId === address?.parentSessionId && this.address?.childSessionId === address?.childSessionId && this.address?.mode === address?.mode;
				this.address = address;
				this.parentAvailable = parentAvailable;
				if (!same && this.openState !== "cold") this.resync();
				else this.notifier.markDirty();
			}
			/**
			* Update only the parent availability hint from a catalog refresh.
			* @param available - whether the exact direct parent is live.
			*/
			handleSubagentParentAvailable(available) {
				if (this.parentAvailable === available) return;
				this.parentAvailable = available;
				this.notifier.markDirty();
			}
			/**
			* Apply the Manager's effective display blank, further reconciled with the
			* current `sessionListMetadata` projection. Local send attempts and current
			* running state prevent re-blanking; an earlier false summary alone does not.
			* The Manager retains acceptance and earlier running observations across
			* Session-object replacement.
			* @param blank - New Session display state after Manager reconciliation.
			*/
			handleBlank(blank) {
				blank = blank && this.projections.values().sessionListMetadata?.blank !== false;
				if (blank === this.blankBit) return;
				if (blank && (this.promptAttempted || this.running)) return;
				this.blankBit = blank;
				this.notifier.markDirty();
			}
			/** `api-session/removed` relay: flag the snapshot while retaining the resident instance. */
			handleRemoved() {
				this.removed = true;
				this.notifier.markDirty();
			}
			/**
			* `api-session/error` relay: the outlet for live failures with no turn position.
			* @param message - the stringified error.
			*/
			handleAgentError(message) {
				this.lastAgentError = message;
				this.notifier.markDirty();
			}
			/**
			* Stop the Session's live Remote source.
			* @returns when the Remote iterator has completed teardown.
			*/
			async dispose() {
				this.stopObservingInbox();
				for (const [requestId, settlement] of [...this.submissionSettlements]) if (settlement.admitted !== void 0) this.scheduleObservedRetirement(requestId, settlement.admitted);
				else this.retireFailedSubmission(requestId);
				this.openGeneration++;
				const events = this.events;
				this.events = void 0;
				await events?.dispose();
			}
			/** @param generation - openGeneration at launch; stale passes cannot publish after replacement. */
			async doOpen(generation) {
				this.openState = "loading";
				this.openError = null;
				this.notifier.markDirty();
				const events = new SessionEventStream(this.remote, this.sessionAddress(), {
					publish: (change) => {
						if (generation !== this.openGeneration || this.events !== events) return;
						this.acceptEventChange(change);
					},
					failed: (error) => {
						this.failEventStream(events, generation, error);
					}
				});
				this.events = events;
				try {
					await events.open(HISTORY_PAGE_OPTIONS);
					if (generation !== this.openGeneration || this.events !== events) return;
					this.openState = "open";
				} catch (error) {
					if (generation !== this.openGeneration || this.events !== events) return;
					if (!(0, _deepseek_ai_dsh_api_gateway_client.isRemoteFailure)(error)) throw error;
					this.events = void 0;
					this.openState = "error";
					this.openError = error;
				} finally {
					if (generation === this.openGeneration) this.notifier.markDirty();
				}
			}
			/** Apply one contiguous journal update already reconciled by the Remote stream. */
			acceptEventChange(change) {
				switch (change.type) {
					case "replace":
						this.installWindow(change.entries, change.hasMore, change.page.projections === void 0 ? void 0 : projectionsBaseline(change.page.projections), change.page.assistantStream);
						return;
					case "prepend":
						this.prependWindow(change.entries, change.hasMore);
						return;
					case "append":
						this.publishAssistantEntry(this.assistantStream.acceptDurable(change.entry));
						return;
					case "assistant-stream": this.publishAssistantEntry(this.assistantStream.acceptFrame(change.frame));
				}
			}
			/** Replace the complete contiguous window and apply page-owned projection metadata. */
			installWindow(entries, hasMore, projections, assistantStream) {
				const visible = this.assistantStream.replace(entries, assistantStream);
				this.baseSeq = SessionLogOffset(entries[0]?.event.seq ?? 0);
				this.hasMore = hasMore;
				if (this.pendingHistory !== null) {
					this.pendingHistory.beforeSeq = this.baseSeq;
					this.pendingHistory.hasMore = hasMore;
					this.pendingHistory.pages.length = 0;
				}
				if (visible.some((entry) => entry.event.type === "turn/start")) this.firstPromptPendingTurn = false;
				if (projections !== void 0) this.projections.seed(projections);
				this.eventSource.replace(visible, hasMore);
				if (projections !== void 0) {
					for (const [requestId, { receipt }] of this.submissionSettlements) if (receipt !== void 0 && receipt.seq <= projections.asOfSeq) this.scheduleObservedRetirement(requestId, receipt.attachments);
				}
				for (const entry of visible) this.observeSubmissionEvent(entry.event);
				if (projections !== void 0) {
					const inbox = projections.values.inbox;
					for (const target of ["next-turn", "next-step"]) this.observeSubmissionInsertions(target, inbox?.[target] ?? [], 0, projections.asOfSeq);
				}
				this.notifier.markDirty();
			}
			publishAssistantEntry(result) {
				if (result?.type === "rebaseline") {
					const events = this.events;
					queueMicrotask(() => {
						if (events !== void 0 && this.events === events) events.restart();
					});
					return;
				}
				if (result?.type === "settlement") {
					this.eventSource.settleAssistant(result.attemptId, result.entry);
					this.observeSubmissionEvent(result.entry.event);
					this.notifier.markDirty();
					return;
				}
				if (result?.type === "abandonment") {
					this.eventSource.settleAssistant(result.attemptId);
					this.notifier.markDirty();
					return;
				}
				if (result?.type === "publish") {
					const changed = this.appendLive(result.entry);
					if (result.retireAttemptId !== void 0) this.eventSource.settleAssistant(result.retireAttemptId);
					if (changed || result.retireAttemptId !== void 0) this.notifier.markDirty();
				} else if (result?.type === "transient") {
					this.eventSource.append(result.entry);
					this.notifier.markDirty();
				}
			}
			/** Prepend one stream-validated history page. */
			prependWindow(entries, hasMore) {
				if (this.pendingHistory !== null) {
					const pending = this.pendingHistory;
					pending.beforeSeq = entries[0] === void 0 ? pending.beforeSeq : SessionLogOffset(entries[0].event.seq);
					pending.hasMore = hasMore;
					pending.pages.push(entries);
					return;
				}
				this.baseSeq = entries[0] === void 0 ? this.baseSeq : SessionLogOffset(entries[0].event.seq);
				this.hasMore = hasMore;
				this.eventSource.prepend(entries, hasMore);
			}
			/** Append one stream-validated live event. */
			appendLive(entry) {
				const event = entry.event;
				const awaitingFirstTurn = this.firstPromptPendingTurn;
				if (event.type === "turn/start") this.firstPromptPendingTurn = false;
				this.eventSource.append(entry);
				this.observeSubmissionEvent(event);
				return awaitingFirstTurn !== this.firstPromptPendingTurn;
			}
			/** Observe durable acceptance even when insertion and claim share one projection notification. */
			observeSubmissionEvent(event) {
				if (this.submissionSettlements.size === 0) return;
				if (event.type === "agent/inbox/spliced") {
					const { target, start, removedCount = 0, inserted, outcome } = event.data;
					for (const [requestId, settlement] of this.submissionSettlements) {
						const receipt = settlement.receipt;
						if (receipt?.target !== target || receipt.index === null || receipt.seq >= event.seq) continue;
						const removed = receipt.index >= start && receipt.index < start + removedCount;
						if (removed && outcome === "canceled") this.retireFailedSubmission(requestId);
						else settlement.receipt = {
							...receipt,
							seq: event.seq,
							index: removed ? null : receipt.index < start ? receipt.index : receipt.index + inserted.length - removedCount
						};
					}
					this.observeSubmissionInsertions(target, inserted, start, event.seq);
					for (const message of inserted) this.observeSubmissionMessage(message, false);
					return;
				}
				if (event.type === "request/context" || event.type === "turn/end") {
					for (const [requestId, settlement] of this.submissionSettlements) if (settlement.admitted === void 0 && settlement.receipt?.index === null && settlement.receipt.seq < event.seq) this.retireFailedSubmission(requestId);
					return;
				}
				if (event.type === "user/message") this.observeSubmissionMessage(event.data, true);
			}
			observeSubmissionInsertions(target, messages, start, seq) {
				for (const [index, message] of messages.entries()) {
					const source = message.source;
					if (source.kind !== "user" || !("rpcId" in source)) continue;
					const settlement = this.submissionSettlements.get(source.rpcId);
					if (settlement === void 0 || settlement.placement === "queued" || settlement.retiring || (settlement.receipt?.seq ?? -1) > seq) continue;
					settlement.receipt = {
						target,
						seq,
						index: start + index,
						attachments: attachmentRefsIn(message.content)
					};
				}
			}
			observeSubmissionMessage(message, admitted) {
				const source = message.source;
				if (source.kind !== "user" || !("rpcId" in source)) return;
				const settlement = this.submissionSettlements.get(source.rpcId);
				if (settlement === void 0 || settlement.retiring) return;
				if (!admitted) {
					if (settlement.placement === "queued") this.scheduleObservedRetirement(source.rpcId, attachmentRefsIn(message.content));
					return;
				}
				settlement.admitted = attachmentRefsIn(message.content);
				this.retireAdmittedSubmission(source.rpcId);
			}
			/** Retire admitted Chat identities only after stale Inbox rows can no longer reappear. */
			retireAdmittedSubmission(requestId) {
				const settlement = this.submissionSettlements.get(requestId);
				if (settlement?.admitted === void 0) return;
				const receipt = settlement.receipt;
				if (receipt?.index === null && (this.projections.seqOf("inbox") ?? -1) < receipt.seq) return;
				this.scheduleObservedRetirement(requestId, settlement.admitted);
			}
			/** Inbox acceptance retires queued echoes; its watermark completes admitted Chat handoffs. */
			observeSubmissionInbox() {
				if (this.submissionSettlements.size === 0) return;
				const inbox = this.projections.get("inbox");
				if (inbox === void 0) return;
				const seq = this.projections.seqOf("inbox");
				for (const target of ["next-turn", "next-step"]) {
					if (seq !== void 0) this.observeSubmissionInsertions(target, inbox[target], 0, seq);
					for (const message of inbox[target]) this.observeSubmissionMessage(message, false);
				}
				for (const requestId of this.submissionSettlements.keys()) this.retireAdmittedSubmission(requestId);
			}
			/**
			* Latch one observed settlement and remove the echo an animation frame
			* later. The delay keeps the echo in the snapshot until the frame in which
			* the durable node (whose assembly frame was registered first) is
			* renderable; the render-time rpcId dedupe hides the one-frame overlap.
			*/
			scheduleObservedRetirement(requestId, attachments) {
				const settlement = this.submissionSettlements.get(requestId);
				if (settlement === void 0 || settlement.retiring) return;
				settlement.retiring = true;
				scheduleFrame(() => {
					this.finishSubmission(requestId, {
						reason: "observed",
						attachments
					});
				});
			}
			/** Remove one unsettled echo immediately (prompt rejection, abort, or disposal). */
			retireFailedSubmission(requestId) {
				const settlement = this.submissionSettlements.get(requestId);
				if (settlement === void 0 || settlement.retiring || settlement.admitted !== void 0) return;
				settlement.retiring = true;
				this.finishSubmission(requestId, { reason: "failed" });
			}
			/** Single removal point: drop the echo, publish, then notify the owner. */
			finishSubmission(requestId, retirement) {
				const settlement = this.submissionSettlements.get(requestId);
				/* v8 ignore next -- retiring latches before every schedule, so one settlement never finishes twice. */
				if (settlement === void 0) return;
				this.submissionSettlements.delete(requestId);
				this.pendingSubmissions = this.pendingSubmissions.filter((echo) => echo.requestId !== requestId);
				this.notifier.markDirty();
				settlement.onRetire?.(retirement);
			}
			/** Publish a terminal background failure only while this stream still owns the Session. */
			failEventStream(events, generation, error) {
				if (generation !== this.openGeneration || this.events !== events) return;
				if (!(0, _deepseek_ai_dsh_api_gateway_client.isRemoteFailure)(error)) throw error;
				this.openGeneration++;
				this.events = void 0;
				this.openPromise = null;
				this.openState = "error";
				this.openError = error;
				events.dispose();
				this.notifier.markDirty();
			}
			buildSnapshot() {
				const identity = this.projections.values().subagent;
				return {
					sessionId: this.sessionId,
					pendingSubmissions: this.pendingSubmissions,
					running: this.running,
					subagent: this.address === void 0 ? null : {
						address: this.address.mode === "unknown" && identity != null ? {
							...this.address,
							mode: identity.mode
						} : this.address,
						...this.parentAvailable === void 0 ? {} : { parentAvailable: this.parentAvailable }
					},
					removed: this.removed,
					openState: this.openState,
					openError: this.openError,
					hasMore: this.hasMore,
					loadingOlder: this.loadingOlder,
					promptError: this.promptError,
					blank: this.blankBit,
					lastAgentError: this.lastAgentError,
					promptAttempted: this.promptAttempted,
					awaitingFirstTurn: this.firstPromptPendingTurn
				};
			}
			sessionAddress() {
				return this.address === void 0 ? {
					kind: "session",
					sessionId: this.sessionId
				} : {
					kind: "subagent",
					...this.address
				};
			}
		};
		/** Run one callback on the next animation frame, or a macrotask where no frame clock exists. */
		function scheduleFrame(fn) {
			if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
				fn();
			});
			else setTimeout(fn, 0);
		}
		/** Attachment references in one structurally-read content block list, in block order. */
		function attachmentRefsIn(content) {
			if (!Array.isArray(content)) return [];
			const refs = [];
			for (const block of content) {
				if (typeof block !== "object" || block === null) continue;
				const candidate = block;
				if ((candidate.type === "image" || candidate.type === "file") && typeof candidate.attachment === "object" && candidate.attachment !== null) refs.push(candidate.attachment);
			}
			return refs;
		}
		//#endregion
		//#region lib/types/client/sessions/manager.js
		/** Host catalog, durable projection caches, and explicitly retained Client instances. */
		function sessionSeqCursor(value) {
			return value === -1 ? -1 : SessionSeq(value);
		}
		/** Instance cluster + frame entry + the session list. */
		var SessionManager = class {
			remote;
			sessions = /* @__PURE__ */ new Map();
			/** In-flight Session disposals remain here after instances leave `sessions`, so manager disposal can await quiescence. */
			sessionDisposals = /* @__PURE__ */ new Set();
			/**
			* Accepted/running presentation must survive a later empty-history list
			* response. Host-asserted running is recorded even before a row, instance, or
			* address holds the identity — the listing that would hold it may not have
			* landed yet — while the client-local acceptance callback requires a current
			* holder, because it can arrive from a replaced or already-dropped Session.
			*/
			engagedSessions = /* @__PURE__ */ new Set();
			disposed = false;
			/** Per-session projection value stores, retained independently of instance arrival (the
			*  title-snapshot precedent, generalized): push frames land here whether or not the Session
			*  is instantiated (list rows read the 'title' key), and an instantiated Session adopts the
			*  same store so history-baseline seeding and frames converge on one row set. */
			projectionStores = /* @__PURE__ */ new Map();
			summaries = [];
			listState = "idle";
			/** Arrival phase; the pending → ready edge fires on the first successful pull (see SessionListPhase). */
			listPhase = "pending";
			listError = null;
			listInflight = null;
			/** Active list request's mutation log; its identity also fences completion after reconnect. */
			listMutations = null;
			addresses = /* @__PURE__ */ new Map();
			projectionLoads = /* @__PURE__ */ new Map();
			projectionInflight = /* @__PURE__ */ new Map();
			listSnapshotCache;
			/** Entry-identity cache (reference stability): list rebuilds reuse the previous entry
			*  object when every field matches — wire refreshes mint all-new summary objects, so identity
			*  must be recovered by value or every SessionListItem memo misses on every refresh. */
			entryCache = /* @__PURE__ */ new Map();
			itemsCache = [];
			notifier = new Notifier(() => {
				this.listSnapshotCache = this.buildListSnapshot();
			});
			/** @param remote - generated Remote namespaces used by catalog and history readers. */
			constructor(remote) {
				this.remote = remote;
				this.listSnapshotCache = this.buildListSnapshot();
			}
			/**
			* Resolve an acquisition target without materializing a Session.
			* @param target - known identity or durable direct-parent address.
			* @returns the resolved identity with its explicit or catalog-derived history route installed.
			*/
			resolveTarget(target) {
				const id = typeof target === "string" ? target : target.childSessionId;
				const address = typeof target === "string" ? this.subagentAddress(id) : target;
				if (typeof target === "string" && !this.sessions.has(id) && !this.summaries.some((summary) => summary.sessionId === id) && address === void 0) throw new Error(`sessions.retain: unknown session ${id}`);
				if (address !== void 0) this.addresses.set(id, address);
				this.sessions.get(id)?.configureSubagent(address, address === void 0 ? void 0 : this.agentAvailable(address.parentSessionId));
				return id;
			}
			/**
			* Resolve an address for breadcrumb navigation without retaining transport authority.
			* @param sessionId - possible child id in an already-loaded catalog.
			* @returns A retained or catalog-derived direct-parent address.
			*/
			subagentAddress(sessionId) {
				const retained = this.addresses.get(sessionId);
				if (retained !== void 0) return retained;
				for (const parentSessionId of this.projectionStores.keys()) {
					const child = this.projectionStores.get(parentSessionId)?.values().subagentCatalog?.find((entry) => entry.id === sessionId);
					if (child !== void 0) return {
						parentSessionId,
						childSessionId: sessionId,
						mode: child.mode
					};
				}
			}
			/**
			* Withdraw an exact Client instance before running its teardown callbacks.
			* @param sessionId - identity to withdraw.
			* @param expected - instance being released; a replacement is left untouched.
			* @returns completion of the detached instance's stream teardown.
			*/
			drop(sessionId, expected) {
				const session = this.sessions.get(sessionId);
				if (session !== expected) return Promise.resolve();
				this.sessions.delete(sessionId);
				this.addresses.delete(sessionId);
				this.pruneEngagement(sessionId, this.retainedIds(this.summaries));
				return this.startSessionDisposal(session);
			}
			/**
			* Stop catalog requests and dispose every resident Session.
			* @returns once catalog requests and every Session stream have stopped.
			*/
			async dispose() {
				this.disposed = true;
				this.listMutations = null;
				this.listInflight = null;
				this.engagedSessions.clear();
				const reads = [...this.projectionInflight.values()];
				for (const { controller } of reads) controller.abort();
				this.projectionInflight.clear();
				await Promise.all(reads.map((read) => read.promise));
				const sessions = [...this.sessions.values()];
				this.sessions.clear();
				this.addresses.clear();
				for (const session of sessions) this.startSessionDisposal(session);
				await this.drainSessionDisposals();
			}
			startSessionDisposal(session) {
				const disposal = session.dispose();
				this.sessionDisposals.add(disposal);
				disposal.then(() => {
					this.sessionDisposals.delete(disposal);
				}, () => {
					this.sessionDisposals.delete(disposal);
				});
				return disposal;
			}
			async drainSessionDisposals() {
				while (this.sessionDisposals.size > 0) await Promise.allSettled([...this.sessionDisposals]);
			}
			/**
			* Lazy build: return the existing instance or construct one (no auto-open —
			* the reference allocator opens history after binding the scope).
			* New instances reconcile retained metadata before returning.
			* @param sessionId - the session to get.
			* @returns the resident instance.
			*/
			get(sessionId) {
				let session = this.sessions.get(sessionId);
				if (session === void 0) {
					session = this.createSession(sessionId);
					this.sessions.set(sessionId, session);
					const summary = this.summaries.find((s) => s.sessionId === sessionId);
					if (summary !== void 0) {
						session.handleBlank(this.effectiveBlank(summary));
						session.handleRunning(summary.running);
					} else {
						const address = this.addresses.get(sessionId);
						if ((address === void 0 ? void 0 : this.projectionStores.get(address.parentSessionId)?.values().subagentCatalog?.find((entry) => entry.id === sessionId)) !== void 0) {
							session.handleBlank(false);
							session.handleRunning(false);
						} else session.handleBlank(true);
					}
				}
				return session;
			}
			createSession(sessionId) {
				const address = this.addresses.get(sessionId);
				const parentAvailable = address === void 0 ? void 0 : this.agentAvailable(address.parentSessionId);
				return new Session(sessionId, this.remote, {
					...address === void 0 ? {} : {
						address,
						...parentAvailable === void 0 ? {} : { parentAvailable }
					},
					onEngaged: (engaged) => {
						if (this.disposed || !this.retainedIds(this.summaries).has(engaged.sessionId)) return;
						if (!this.engagedSessions.has(engaged.sessionId)) {
							this.engagedSessions.add(engaged.sessionId);
							this.recordMutation({
								kind: "engaged",
								sessionId: engaged.sessionId
							});
						}
						this.sessions.get(engaged.sessionId)?.handleBlank(false);
					},
					projections: this.projectionStore(sessionId)
				});
			}
			effectiveBlank(summary) {
				return summary.blank && !this.engagedSessions.has(summary.sessionId);
			}
			/**
			* Identities an engagement may still belong to: the given list rows, resident
			* Session instances, and retained child addresses.
			* @param summaries - list rows of the caller's snapshot.
			* @returns the retained identity set.
			*/
			retainedIds(summaries) {
				const retained = new Set(summaries.map((summary) => summary.sessionId));
				for (const sessionId of this.sessions.keys()) retained.add(sessionId);
				for (const sessionId of this.addresses.keys()) retained.add(sessionId);
				return retained;
			}
			/**
			* Forget one engagement that no retained identity holds.
			* @param sessionId - identity whose engagement may be dropped.
			* @param retained - identities from {@link retainedIds} for the caller's snapshot.
			*/
			pruneEngagement(sessionId, retained) {
				if (!retained.has(sessionId)) this.engagedSessions.delete(sessionId);
			}
			/** Resident per-session projection store (create-on-demand; outlives instantiation). */
			projectionStore(sessionId) {
				let store = this.projectionStores.get(sessionId);
				if (store === void 0) {
					store = new ProjectionValueStore();
					const projections = store;
					store.subscribeAny(() => {
						if (projections.values().sessionListMetadata?.blank === false) this.sessions.get(sessionId)?.handleBlank(false);
						this.notifier.markDirty();
					});
					this.projectionStores.set(sessionId, store);
				}
				return store;
			}
			/**
			* Load a complete projection baseline once per connection; retry unsuccessful reads.
			* @param sessionId - Session to inspect without opening its conversation.
			* @returns completion of the current or newly started read.
			*/
			refreshProjections(sessionId) {
				const existing = this.projectionInflight.get(sessionId);
				if (existing !== void 0) return existing.promise;
				if (this.projectionLoads.get(sessionId)?.state === "ready") return Promise.resolve();
				const controller = new AbortController();
				const store = this.projectionStore(sessionId);
				const initialValues = store.values();
				this.projectionLoads.set(sessionId, {
					state: "loading",
					error: null
				});
				this.notifier.markDirty();
				const operation = (async () => {
					try {
						const result = await this.remote.session.projections({ sessionId }, controller.signal);
						if (controller.signal.aborted) return;
						if (result.ok) {
							if (result.value !== null) store.seed({
								...result.value,
								asOfSeq: sessionSeqCursor(result.value.asOfSeq)
							});
							else if (store.values() === initialValues) store.clear();
							this.projectionLoads.set(sessionId, {
								state: "ready",
								error: null
							});
						} else this.projectionLoads.set(sessionId, {
							state: "error",
							error: result.error
						});
					} catch (error) {
						if (controller.signal.aborted) return;
						if (!(0, _deepseek_ai_dsh_api_gateway_client.isRemoteFailure)(error)) throw error;
						this.projectionLoads.set(sessionId, {
							state: "error",
							error
						});
					} finally {
						if (!controller.signal.aborted) {
							this.projectionInflight.delete(sessionId);
							this.notifier.markDirty();
						}
					}
				})();
				this.projectionInflight.set(sessionId, {
					promise: operation,
					controller
				});
				return operation;
			}
			agentAvailable(sessionId) {
				return this.summaries.find((summary) => summary.sessionId === sessionId)?.agentAvailable ?? (this.listPhase === "ready" ? false : void 0);
			}
			updateParentAvailability() {
				for (const [childId, address] of this.addresses) {
					const available = this.agentAvailable(address.parentSessionId);
					if (available !== void 0) this.sessions.get(childId)?.handleSubagentParentAvailable(available);
				}
			}
			/** Full refresh via session.list (single-flight within one Host generation). */
			refreshList() {
				if (this.listInflight !== null) return this.listInflight;
				this.listState = "loading";
				this.listError = null;
				const established = this.summaries;
				const mutations = [];
				this.listMutations = mutations;
				this.notifier.markDirty();
				this.listInflight = (async () => {
					try {
						const result = await this.remote.session.list({});
						if (this.listMutations !== mutations) return;
						if (result.ok) {
							const baseline = this.listPhase === "pending" ? [...result.value.items] : mergeOrderedBaseline(established, result.value.items, (summary) => summary.sessionId);
							const removedSincePull = /* @__PURE__ */ new Set();
							for (const mutation of mutations) if (mutation.kind === "remove") removedSincePull.add(mutation.sessionId);
							for (const s of baseline) if (s.running && !removedSincePull.has(s.sessionId)) this.engagedSessions.add(s.sessionId);
							const summaries = mutations.reduce(applyMutation, baseline);
							this.summaries = summaries;
							const retained = this.retainedIds(summaries);
							for (const sessionId of this.engagedSessions) this.pruneEngagement(sessionId, retained);
							this.listState = "idle";
							this.listPhase = "ready";
							this.updateParentAvailability();
							for (const s of this.summaries) {
								const session = this.sessions.get(s.sessionId);
								if (session === void 0) continue;
								session.handleBlank(this.effectiveBlank(s));
								session.handleRunning(s.running);
							}
							for (const s of result.value.items) if (s.projections !== void 0) this.applyListBlock(s.sessionId, s.projections);
						} else {
							this.listState = "error";
							this.listError = result.error;
						}
					} catch (error) {
						if (!(0, _deepseek_ai_dsh_api_gateway_client.isRemoteFailure)(error)) throw error;
						if (this.listMutations !== mutations) return;
						this.listState = "error";
						this.listError = error;
					} finally {
						if (this.listMutations === mutations) {
							this.listMutations = null;
							this.listInflight = null;
							this.notifier.markDirty();
						}
					}
				})();
				return this.listInflight;
			}
			/**
			* Search visible session message content without adding transient query
			* state to the list snapshot.
			* @param query - non-blank literal phrase.
			* @param signal - cancellation for superseded UI queries.
			* @returns the Host result or a folded transport error.
			*/
			async search(query, signal) {
				const result = await this.remote.session.search({ query }, signal);
				if (!result.ok) return result;
				return {
					ok: true,
					value: {
						items: [...result.value.items],
						hasMore: result.value.hasMore
					}
				};
			}
			/**
			* Contract session.create; on success merge into summaries immediately (no
			* wait for the next refresh). A created session is blank by definition
			* (entity birth precedes the first message).
			* @param opts - target workspace or working directory, plus an optional caller-owned id.
			* @returns the create result.
			*/
			async create(opts = {}) {
				const shared = opts.sessionId === void 0 ? {} : { sessionId: opts.sessionId };
				const payload = opts.workspaceId !== void 0 ? {
					workspaceId: opts.workspaceId,
					...shared
				} : {
					...opts.cwd === void 0 ? {} : { cwd: opts.cwd },
					...shared
				};
				const result = await this.remote.session.create(payload);
				if (result.ok) this.recordMutation({
					kind: "placeholder",
					summary: {
						agentAvailable: true,
						sessionId: result.value.sessionId,
						updatedAt: Date.now(),
						running: false,
						blank: true,
						...opts.cwd !== void 0 ? { cwd: opts.cwd } : {}
					}
				});
				else {
					const publishedSessionId = workspaceAttachSessionId(result.error);
					if (publishedSessionId !== void 0) this.recordMutation({
						kind: "placeholder",
						summary: {
							agentAvailable: true,
							sessionId: publishedSessionId,
							updatedAt: Date.now(),
							running: false,
							blank: true
						}
					});
				}
				return result;
			}
			/**
			* Contract session.fork; on success merge the child into summaries
			* immediately (same synchronous-addressability guarantee as create).
			* Blankness starts provisionally true so the authoritative Host summary can
			* preserve it or lower it after an exact cut before the first `turn/start`;
			* lineage rides parentSessionId. A child published before Workspace
			* attachment fails is also reconciled into the list.
			* @param opts - source session and the optional exact inclusive boundary seq.
			* @returns the fork result (the child session id).
			*/
			async fork(opts) {
				const source = this.summaries.find((s) => s.sessionId === opts.sessionId);
				const result = await this.remote.session.fork({
					sessionId: opts.sessionId,
					...opts.atSeq === void 0 ? {} : { atSeq: opts.atSeq }
				});
				const childId = result.ok ? result.value.sessionId : workspaceAttachSessionId(result.error);
				if (childId !== void 0) this.recordMutation({
					kind: "placeholder",
					summary: {
						agentAvailable: true,
						sessionId: childId,
						updatedAt: Date.now(),
						running: false,
						blank: true,
						parentSessionId: opts.sessionId,
						...source?.cwd !== void 0 ? { cwd: source.cwd } : {}
					}
				});
				return result;
			}
			/**
			* Rename a Session and update its title projection without opening its history.
			* @param sessionId - Session to rename.
			* @param title - raw title text for Host normalization.
			* @returns the accepted title and event position, or the Remote failure.
			*/
			async rename(sessionId, title) {
				const result = await this.remote.session.rename({
					sessionId,
					title
				});
				if (result.ok) this.projectionStore(sessionId).apply("title", result.value.title, SessionSeq(result.value.seq));
				return result;
			}
			/**
			* Merge a Host summary, replacing live state and filling missing metadata.
			* Local create/fork placeholders only fill metadata on an existing row.
			*/
			mergeSummary(summary) {
				this.recordMutation({
					kind: "upsert",
					summary
				});
				this.updateParentAvailability();
			}
			/** Apply immediately and retain for replay when a list response is in flight. */
			recordMutation(mutation) {
				if (this.disposed) return;
				this.listMutations?.push(mutation);
				this.summaries = applyMutation(this.summaries, mutation);
				this.notifier.markDirty();
			}
			/**
			* uSES subscription entry for useSessionList.
			* @param listener - change callback.
			* @returns the unsubscribe function.
			*/
			subscribe(listener) {
				return this.notifier.subscribe(listener);
			}
			/**
			* Cached list snapshot (rebuilt lazily when dirty with no listeners).
			* @returns the cached reference (stable until the next flush).
			*/
			getListSnapshot() {
				this.notifier.ensureFresh();
				return this.listSnapshotCache;
			}
			/**
			* Read cached projection values for a Session that may exist only in a loaded subagent catalog.
			* @param sessionId - Session whose control or history baseline supplied projections.
			* @returns current values, or undefined before any projection store exists.
			*/
			projectionValues(sessionId) {
				return this.projectionStores.get(sessionId)?.values();
			}
			/**
			* Apply a complete control baseline or one later replacement frame.
			* @param frame - baseline or live control replacement from Session Controller.
			*/
			handleControlFrame(frame) {
				if (frame.type === "baseline") {
					this.replaceControlBaseline(frame.value);
					return;
				}
				this.projectionStore(frame.sessionId).apply(frame.key, frame.value, SessionSeq(frame.seq));
				this.notifier.markDirty();
			}
			replaceControlBaseline(baseline) {
				for (const [sessionId, block] of Object.entries(baseline.projections)) {
					const store = this.projectionStore(sessionId);
					const asOfSeq = sessionSeqCursor(block.asOfSeq);
					store.seed({
						...block,
						asOfSeq
					});
				}
				this.notifier.markDirty();
			}
			/**
			* Apply one Session-list addition forwarded through `ctx.remote.$on`.
			* @param summary - current Host summary for the added Session.
			*/
			handleSessionAdded(summary) {
				this.mergeSummary(summary);
				if (!this.disposed && summary.running) this.engagedSessions.add(summary.sessionId);
				this.sessions.get(summary.sessionId)?.handleBlank(this.effectiveBlank(summary));
				if (summary.projections !== void 0) this.applyListBlock(summary.sessionId, summary.projections);
			}
			/**
			* Merge one list-surface projection block by the sequence space it declares.
			* A `sequenced` block came from the Host's live registry for an attached
			* Session, so each key lands under higher-seq-wins against that Session's
			* baselines and frames. A `cached` block was viewed from the persisted
			* checkpoint by a header-only listing: its watermark is not comparable with
			* this connection's seqs, so it only fills keys no sequenced row holds.
			*/
			applyListBlock(sessionId, block) {
				const store = this.projectionStore(sessionId);
				switch (block.kind) {
					case "sequenced": {
						const seq = sessionSeqCursor(block.asOfSeq);
						for (const [key, value] of Object.entries(block.values)) store.apply(key, value, seq);
						return;
					}
					case "cached":
						store.applyCached(block.values);
						return;
					default: assertNever(block.kind, "session list projection block kind");
				}
			}
			/**
			* Apply one Session removal forwarded through `ctx.remote.$on`.
			* @param sessionId - removed Session identity.
			*/
			handleSessionRemoved(sessionId) {
				const durableSubagent = this.subagentAddress(sessionId) !== void 0 || this.summaries.some((summary) => summary.sessionId === sessionId && summary.origin === "subagent");
				this.recordMutation(durableSubagent ? {
					kind: "status",
					sessionId,
					running: false,
					agentAvailable: false
				} : {
					kind: "remove",
					sessionId
				});
				if (durableSubagent) this.sessions.get(sessionId)?.handleRunning(false);
				else this.sessions.get(sessionId)?.handleRemoved();
				const catalog = this.projectionStores.get(sessionId)?.values().subagentCatalog;
				if (!durableSubagent && (catalog === void 0 || catalog.length === 0)) this.projectionStores.delete(sessionId);
				this.pruneEngagement(sessionId, this.retainedIds(this.summaries));
				this.projectionInflight.get(sessionId)?.controller.abort();
				this.projectionInflight.delete(sessionId);
				this.projectionLoads.delete(sessionId);
				for (const [childId, address] of this.addresses) if (address.parentSessionId === sessionId) this.sessions.get(childId)?.handleSubagentParentAvailable(false);
			}
			/**
			* Apply one live Agent running-state change.
			* @param sessionId - Session whose Agent state changed.
			* @param running - current Agent running state.
			*/
			handleSessionStatus(sessionId, running) {
				if (!this.disposed && running) this.engagedSessions.add(sessionId);
				this.recordMutation({
					kind: "status",
					sessionId,
					running,
					agentAvailable: true
				});
				this.updateParentAvailability();
				this.sessions.get(sessionId)?.handleRunning(running);
			}
			/**
			* Advance Session-list activity from one user-authored durable message.
			* @param sessionId - Session whose activity changed.
			* @param updatedAt - durable message timestamp.
			*/
			handleSessionActivity(sessionId, updatedAt) {
				this.recordMutation({
					kind: "activity",
					sessionId,
					updatedAt
				});
			}
			/**
			* Surface one live Agent failure on an already-materialized Session.
			* @param sessionId - Session whose Agent failed.
			* @param message - caller-visible failure description.
			*/
			handleSessionError(sessionId, message) {
				this.sessions.get(sessionId)?.handleAgentError(message);
			}
			/**
			* Repair one re-established Host-event generation with queryable baselines.
			* Discard old projection cuts before new queries, including cold Sessions
			* absent from the process-local control baseline.
			* Opened Session follow streams resume independently through API Gateway.
			*/
			handleConnected() {
				for (const store of this.projectionStores.values()) store.clear();
				this.listMutations = null;
				this.listInflight = null;
				this.refreshList();
				const parents = new Set(this.projectionLoads.keys());
				for (const id of this.sessions.keys()) {
					const address = this.addresses.get(id);
					if (address !== void 0) parents.add(address.parentSessionId);
				}
				for (const { controller } of this.projectionInflight.values()) controller.abort();
				this.projectionInflight.clear();
				this.projectionLoads.clear();
				for (const parentSessionId of parents) this.refreshProjections(parentSessionId);
			}
			buildListSnapshot() {
				const items = flattenLineage(this.summaries.map((summary) => {
					const projectionStore = this.projectionStores.get(summary.sessionId);
					const title = projectionStore?.get("title");
					const projectionValues = projectionStore?.values();
					const metadata = projectionValues?.sessionListMetadata;
					return {
						...summary,
						blank: this.effectiveBlank(summary) && metadata?.blank !== false,
						updatedAt: Math.max(summary.updatedAt, metadata?.lastPromptAt ?? 0),
						...typeof title === "string" && title !== "" ? { title } : {},
						...projectionValues === void 0 ? {} : { projectionValues }
					};
				})).map((entry) => {
					const prev = this.entryCache.get(entry.sessionId);
					if (prev !== void 0 && prev.updatedAt === entry.updatedAt && prev.running === entry.running && prev.blank === entry.blank && prev.parentSessionId === entry.parentSessionId && prev.cwd === entry.cwd && prev.origin === entry.origin && prev.title === entry.title && prev.depth === entry.depth && prev.projectionValues === entry.projectionValues) return prev;
					this.entryCache.set(entry.sessionId, entry);
					return entry;
				});
				const itemIds = new Set(items.map((entry) => entry.sessionId));
				for (const id of this.entryCache.keys()) if (!itemIds.has(id)) this.entryCache.delete(id);
				if (!(items.length === this.itemsCache.length && items.every((e, i) => e === this.itemsCache[i]))) this.itemsCache = items;
				return {
					items: this.itemsCache,
					state: this.listState,
					phase: this.listPhase,
					error: this.listError,
					projectionsBySession: Object.fromEntries([...this.projectionStores].map(([sessionId, store]) => [sessionId, {
						values: store.values(),
						state: "idle",
						error: null,
						...this.projectionLoads.get(sessionId)
					}]))
				};
			}
		};
		/** Apply one list mutation without deriving display order. */
		function applyMutation(summaries, mutation) {
			switch (mutation.kind) {
				case "upsert":
				case "placeholder": {
					const existing = summaries.find((summary) => summary.sessionId === mutation.summary.sessionId);
					if (existing === void 0) return [mutation.summary, ...summaries];
					const filled = {
						...existing,
						blank: existing.blank && mutation.summary.blank,
						...mutation.kind === "upsert" ? {
							agentAvailable: mutation.summary.agentAvailable,
							running: mutation.summary.running
						} : {},
						...existing.cwd === void 0 && mutation.summary.cwd !== void 0 ? { cwd: mutation.summary.cwd } : {},
						...existing.parentSessionId === void 0 && mutation.summary.parentSessionId !== void 0 ? { parentSessionId: mutation.summary.parentSessionId } : {},
						...existing.origin === void 0 && mutation.summary.origin !== void 0 ? { origin: mutation.summary.origin } : {}
					};
					if (filled.cwd === existing.cwd && filled.parentSessionId === existing.parentSessionId && filled.origin === existing.origin && filled.blank === existing.blank && filled.agentAvailable === existing.agentAvailable && filled.running === existing.running) return [...summaries];
					return summaries.map((summary) => summary.sessionId === mutation.summary.sessionId ? filled : summary);
				}
				case "remove": return summaries.filter((summary) => summary.sessionId !== mutation.sessionId);
				case "status": return summaries.map((summary) => summary.sessionId === mutation.sessionId && (summary.running !== mutation.running || summary.agentAvailable !== mutation.agentAvailable || mutation.running && summary.blank) ? {
					...summary,
					running: mutation.running,
					agentAvailable: mutation.agentAvailable,
					blank: summary.blank && !mutation.running
				} : summary);
				case "activity": return summaries.map((summary) => summary.sessionId === mutation.sessionId && mutation.updatedAt > summary.updatedAt ? {
					...summary,
					updatedAt: mutation.updatedAt
				} : summary);
				case "engaged": return summaries.map((summary) => summary.sessionId === mutation.sessionId && summary.blank ? {
					...summary,
					blank: false
				} : summary);
			}
		}
		/** Temporary source-plane bridge while the Host contract and client project build independently. */
		function workspaceAttachSessionId(error) {
			return error.code === "session/workspace-attach-failed" ? error.details.sessionId : void 0;
		}
		//#endregion
		//#region lib/types/client/sessions/service.js
		/** Structured session-create failure. */
		var SessionCreateError = class extends Error {
			rpcError;
			requestedSessionId;
			name = "SessionCreateError";
			/**
			* @param rpcError - Host business or folded transport error.
			* @param requestedSessionId - caller-preallocated id used for later stream/list reconciliation.
			*/
			constructor(rpcError, requestedSessionId) {
				super(`session create failed: ${rpcError.code}: ${rpcError.message}`);
				this.rpcError = rpcError;
				this.requestedSessionId = requestedSessionId;
			}
		};
		/** Structured session-fork failure. */
		var SessionForkError = class extends Error {
			rpcError;
			sourceSessionId;
			name = "SessionForkError";
			/**
			* @param rpcError - Host business or folded transport error.
			* @param sourceSessionId - the session the fork was cut from.
			*/
			constructor(rpcError, sourceSessionId) {
				super(`session fork failed: ${rpcError.code}: ${rpcError.message}`);
				this.rpcError = rpcError;
				this.sourceSessionId = sourceSessionId;
			}
		};
		/**
		* Display title projection: durable title, project directory basename, then
		* the raw id.
		*/
		function displayTitleOf(title, cwd, id) {
			if (title !== void 0) return title;
			if (cwd !== void 0 && cwd !== "") {
				const base = workspaceTitleOf(cwd);
				if (base !== "") return base;
			}
			return id;
		}
		/**
		* Increment a trailing fork number while preserving its half-width or
		* full-width parentheses; an unnumbered title starts with ` (1)`.
		* @param title - source session's durable title.
		* @returns the title assigned to the fork child.
		*/
		function increasedForkTitle(title) {
			const ascii = /^(.*?)\((\d+)\)$/u.exec(title);
			if (ascii?.[1] !== void 0 && ascii[2] !== void 0) return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`;
			const fullWidth = /^(.*?)（(\d+)）$/u.exec(title);
			if (fullWidth?.[1] !== void 0 && fullWidth[2] !== void 0) return `${fullWidth[1]}（${BigInt(fullWidth[2]) + 1n}）`;
			return `${title} (1)`;
		}
		/** Source labels are dictionary keys, including names also present on Object.prototype. */
		function freezeRetainedBy(counts) {
			Object.setPrototypeOf(counts, null);
			return Object.freeze(counts);
		}
		const EMPTY_RETAIN_INFO = Object.freeze({
			referenceCount: 0,
			retainedBy: freezeRetainedBy({})
		});
		/** A cancelled waiter releases only its own reference, not the shared opening. */
		async function waitForOpen(opening, signal) {
			if (signal === void 0) return opening;
			const aborted = Promise.withResolvers();
			const onAbort = () => {
				aborted.reject(signal.reason);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			try {
				if (signal.aborted) onAbort();
				await Promise.race([opening, aborted.promise]);
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
		}
		var ClientSessionReference = class {
			sessionId;
			record;
			releaseReference;
			released = new AbortController();
			readiness = Promise.withResolvers();
			ready = this.readiness.promise;
			constructor(sessionId, record, releaseReference) {
				this.sessionId = sessionId;
				this.record = record;
				this.releaseReference = releaseReference;
				this.ready.catch(() => {});
			}
			get binding() {
				if (this.record === void 0 || !this.record.live) throw new Error(`Session reference "${this.sessionId}" is released`);
				return this.record.binding;
			}
			attachOpening(opening, signal) {
				const waitSignal = signal === void 0 ? this.released.signal : AbortSignal.any([this.released.signal, signal]);
				waitForOpen(opening, waitSignal).then(() => {
					try {
						waitSignal.throwIfAborted();
						this.readiness.resolve(this.binding);
					} catch (error) {
						this.readiness.reject(error);
					}
				}, (error) => {
					this.readiness.reject(error);
				});
			}
			release() {
				const reason = /* @__PURE__ */ new Error(`Session reference "${this.sessionId}" is released`);
				const release = this.releaseReference;
				this.released.abort(reason);
				this.readiness.reject(reason);
				this.record = void 0;
				this.releaseReference = void 0;
				release?.();
			}
			[Symbol.dispose]() {
				this.release();
			}
		};
		/** Host catalog and local reference allocator; view selection remains outside the Controller. */
		var ClientSessions = class {
			rootCtx;
			/**
			* The wire schema's own result bound, re-exposed for presentation plugins as
			* injected data. Not per-connection state: the `session.search` response
			* schema caps `items` at this constant, so every transport (fixture included)
			* reports the same number.
			*/
			searchResultLimit = 20;
			/** Catalog metadata and local reference-source projection. */
			list;
			/** The object-layer instance cluster and frame dispatch entry. */
			manager;
			scopes = /* @__PURE__ */ new Map();
			/** Stable per-id sources retained for the Client root lifetime, including across generation replacement. */
			retainObservers = /* @__PURE__ */ new Map();
			scopeDrops = /* @__PURE__ */ new Set();
			closed = false;
			/**
			* @param ctx - client root context (scope fibers mount under it).
			* @param remote - generated Remote namespaces shared with every Session.
			*/
			constructor(rootCtx, remote) {
				this.rootCtx = rootCtx;
				this.manager = new SessionManager(remote);
				this.list = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
					ids: [],
					byId: {},
					phase: "pending",
					projectionsBySession: {}
				});
				const disposeManagerProjection = this.manager.subscribe(() => {
					this.projectList();
				});
				rootCtx.effect(() => async () => {
					this.closed = true;
					disposeManagerProjection();
					const scopes = [...this.scopes];
					this.scopes.clear();
					for (const [, record] of scopes) {
						record.live = false;
						record.session.unbindScope();
					}
					const managerDisposal = this.manager.dispose();
					for (const [id, record] of scopes) {
						this.startScopeDrop(id, record);
						this.publishRetention(id);
					}
					await this.drainScopeDrops();
					await managerDisposal;
				}, "session-controller.client.sessions");
				rootCtx.reflect.provide("sessions", this, void 0);
			}
			retain(target, options) {
				const { source, signal } = options;
				signal?.throwIfAborted();
				if (this.closed) throw new Error("Session Controller is disposed");
				const id = this.manager.resolveTarget(target);
				const reference = this.retainScope(id, source);
				try {
					reference.attachOpening(this.manager.get(id).open(), signal);
					return reference;
				} catch (error) {
					reference.release();
					throw error;
				}
			}
			async using(target, options, operation) {
				const reference = this.retain(target, options);
				try {
					await reference.ready;
					return await operation(reference);
				} finally {
					reference.release();
				}
			}
			retainInfo(id) {
				let observer = this.retainObservers.get(id);
				if (observer === void 0) {
					const listeners = /* @__PURE__ */ new Set();
					observer = {
						listeners,
						published: this.retentionSnapshot(id),
						source: {
							getSnapshot: () => this.retentionSnapshot(id),
							subscribe: (listener) => {
								listeners.add(listener);
								return () => {
									listeners.delete(listener);
								};
							}
						}
					};
					this.retainObservers.set(id, observer);
				}
				return observer.source;
			}
			/**
			* Resolve an already discovered direct-parent address without opening it.
			* Feature plugins use this to avoid Agent-bound RPCs in persisted child views.
			* @param id - possible addressed child id.
			* @returns A retained or loaded-catalog address, without retaining a new selection or scope.
			*/
			subagentAddress(id) {
				return this.manager.subagentAddress(id);
			}
			/**
			* Load all Session projections once per connection; retry an unsuccessful initial read.
			* @param sessionId - Session to inspect without opening its conversation.
			*/
			refreshProjections(sessionId) {
				return this.manager.refreshProjections(sessionId);
			}
			/**
			* Refresh the real Session baseline, reusing an in-flight pull.
			* @returns completion of the current or newly started baseline pull.
			*/
			refresh() {
				return this.manager.refreshList();
			}
			/**
			* Search the Host's visible message-content index. Results stay
			* request-local; the list snapshot remains the metadata authority.
			* @param query - non-blank literal phrase.
			* @param signal - cancellation for a superseded search.
			* @returns bounded results or a business/transport error.
			*/
			search(query, signal) {
				return this.manager.search(query, signal);
			}
			/**
			* Apply one Session Controller live-control frame.
			* @param frame - baseline or live control replacement.
			*/
			handleControlFrame(frame) {
				this.manager.handleControlFrame(frame);
			}
			/**
			* Apply one remotely forwarded Session-list addition.
			* @param summary - current Host summary for the added Session.
			*/
			handleSessionAdded(summary) {
				this.manager.handleSessionAdded(summary);
			}
			/**
			* Apply one remotely forwarded Session removal.
			* @param sessionId - removed Session identity.
			*/
			handleSessionRemoved(sessionId) {
				this.manager.handleSessionRemoved(sessionId);
			}
			/**
			* Apply one remotely forwarded running-state change.
			* @param args - Session identity and current Agent running state.
			*/
			handleSessionStatus(...args) {
				this.manager.handleSessionStatus(...args);
			}
			/**
			* Apply one remotely forwarded list-activity change.
			* @param args - Session identity and durable activity timestamp.
			*/
			handleSessionActivity(...args) {
				this.manager.handleSessionActivity(...args);
			}
			/**
			* Apply one remotely forwarded Agent failure.
			* @param args - Session identity and caller-visible failure description.
			*/
			handleSessionError(...args) {
				this.manager.handleSessionError(...args);
			}
			/** Rebuild the Session baseline and every opened window after connection. */
			handleConnected() {
				this.manager.handleConnected();
			}
			/**
			* Create a Host Session and publish its catalog row before resolving.
			* Callers retain the returned identity before borrowing its binding.
			* @param opts - target workspace or directory and an optional preallocated id.
			* @returns the new session id.
			* @throws {SessionCreateError} with the requested id.
			*/
			async create(opts = {}) {
				const result = await this.manager.create(opts);
				if (!result.ok) throw new SessionCreateError(result.error, opts.sessionId);
				this.projectList();
				return result.value.sessionId;
			}
			/**
			* Fork a session from an exact inclusive prefix of the source (same
			* synchronous-addressability guarantee as {@link ClientSessions.create}:
			* on resolution the child is catalogued and may be explicitly retained).
			* @param opts - source session id, the optional exact inclusive boundary
			*   seq (a real event seq the caller already knows; a cut inside an open
			*   turn is balanced Host-side with synthetic closers, and omission selects
			*   the latest completed-turn prefix), and whether to increment an
			*   inherited durable title before resolving.
			* @returns the child session id.
			* @throws {SessionForkError} with the source id.
			* @throws {Error} when a requested child-title rename fails after creation.
			*/
			async fork(opts) {
				const sourceTitle = opts.increaseTitle ? this.list.getSnapshot().byId[opts.sessionId]?.title : void 0;
				const result = await this.manager.fork({
					sessionId: opts.sessionId,
					...opts.atSeq === void 0 ? {} : { atSeq: SessionSeq(opts.atSeq) }
				});
				if (!result.ok) throw new SessionForkError(result.error, opts.sessionId);
				this.projectList();
				const childId = result.value.sessionId;
				opts.onCreated?.(childId);
				if (sourceTitle !== void 0) {
					const renamed = await this.manager.rename(childId, increasedForkTitle(sourceTitle));
					if (!renamed.ok) throw new Error(`fork child rename failed: ${renamed.error.code}: ${renamed.error.message}`);
				}
				return childId;
			}
			/**
			* Borrow an already-retained Agent-scoped Context.
			* @param id - session id (the agent identity — 1:1 same axis).
			* @returns the scoped Context, or undefined without a retained generation.
			*/
			scope(id) {
				return this.scopes.get(id)?.ctx;
			}
			/**
			* Retain a validated Gateway identity synchronously, without history or catalog I/O.
			* @param id - Host-projected Session identity, possibly not yet catalogued.
			* @returns a Gateway-source reference owned by the invocation.
			*/
			retainAgentScope(id) {
				if (this.closed) throw new Error("Session Controller is disposed");
				return this.retainScope(id, "gateway");
			}
			/**
			* Read the Agent scope tag off a context. Service-method boundary: fetch
			* bundles must reach scope resolution through ctx.sessions — a cross-bundle
			* value import of the standalone helper would inline a second module
			* instance whose private tag Symbol never matches.
			* @param ctx - any client context.
			* @returns the session id, or undefined on root contexts.
			*/
			scopeOf(ctx) {
				return scopeOf(ctx);
			}
			/**
			* Resolve the business Session behind an Agent-scoped context — the one
			* hop every scoped consumer (event listeners, per-session controllers)
			* takes from ctx-space into object-space (the client mirror of host
			* `agent.session`). Same service-method boundary as
			* {@link ClientSessions.scopeOf}.
			* @param ctx - an Agent-scoped context.
			* @returns the matching live Session, or undefined for an untagged or ended generation.
			*/
			sessionOf(ctx) {
				const id = scopeOf(ctx);
				if (id === void 0) return void 0;
				const record = this.scopes.get(id);
				return record !== void 0 && scopeIdentityOf(record.ctx) === scopeIdentityOf(ctx) ? record.binding.session : void 0;
			}
			/**
			* Borrow an already-retained binding without extending its lifetime.
			* @param id - Session identity.
			* @returns the live binding, or undefined without a retained generation.
			*/
			binding(id) {
				return this.scopes.get(id)?.binding;
			}
			retainScope(id, source) {
				const record = this.scopes.get(id) ?? this.materializeScope(id);
				const previous = record.retention;
				record.retention = Object.freeze({
					referenceCount: previous.referenceCount + 1,
					retainedBy: freezeRetainedBy({
						...previous.retainedBy,
						[source]: (previous.retainedBy[source] ?? 0) + 1
					})
				});
				const reference = new ClientSessionReference(id, record, () => {
					if (!record.live) return;
					const count = record.retention.referenceCount - 1;
					const { [source]: sourceCount = 0, ...otherSources } = record.retention.retainedBy;
					const retainedBy = sourceCount > 1 ? {
						...otherSources,
						[source]: sourceCount - 1
					} : otherSources;
					record.retention = count === 0 ? EMPTY_RETAIN_INFO : Object.freeze({
						referenceCount: count,
						retainedBy: freezeRetainedBy(retainedBy)
					});
					if (count === 0) this.retireScope(id, record);
					else this.publishRetention(id);
				});
				if (this.list.getSnapshot().byId[id] === void 0 && this.manager.subagentAddress(id) !== void 0) this.projectList();
				this.publishRetention(id);
				return reference;
			}
			retentionSnapshot(id) {
				return this.scopes.get(id)?.retention ?? EMPTY_RETAIN_INFO;
			}
			publishRetention(id) {
				const state = this.list.getSnapshot();
				const row = state.byId[id];
				const retainedBy = this.retentionSnapshot(id).retainedBy;
				if (row !== void 0 && row.retainedBy !== retainedBy) this.list.set({
					...state,
					byId: {
						...state.byId,
						[id]: {
							...row,
							retainedBy
						}
					}
				});
				const observer = this.retainObservers.get(id);
				const snapshot = this.retentionSnapshot(id);
				if (observer === void 0 || observer.published === snapshot) return;
				observer.published = snapshot;
				(0, _deepseek_ai_dsh_client_store.notifySubscribers)(observer.listeners, "[session-controller] reference sources");
			}
			retireScope(id, record, disposeFiber = true) {
				if (!record.live) return;
				record.live = false;
				if (this.scopes.get(id) === record) this.scopes.delete(id);
				record.session.unbindScope();
				const sessionDisposal = this.manager.drop(id, record.session);
				this.projectList();
				this.publishRetention(id);
				this.startScopeDrop(id, record, disposeFiber, sessionDisposal);
			}
			/** Materialize one scope after its caller establishes that the id may be addressed. */
			materializeScope(id) {
				const { fiber, ctx } = createScope(this.rootCtx, id);
				const session = this.manager.get(id);
				session.bindScope(ctx);
				const record = {
					fiber,
					ctx,
					binding: {
						sessionId: id,
						session,
						eventSource: session.eventSource,
						ctx
					},
					session,
					retention: EMPTY_RETAIN_INFO,
					live: true
				};
				this.scopes.set(id, record);
				ctx.effect(() => () => {
					this.retireScope(id, record, false);
				}, "session-controller: exact generation");
				return record;
			}
			/** Project the manager's list snapshot into the store (title derivation is display-only). */
			projectList() {
				const previousById = this.list.getSnapshot().byId;
				const { items, phase, projectionsBySession } = this.manager.getListSnapshot();
				const ids = [];
				const byId = {};
				for (const entry of items) {
					ids.push(entry.sessionId);
					byId[entry.sessionId] = {
						id: entry.sessionId,
						displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId),
						running: entry.running,
						retainedBy: this.retentionSnapshot(entry.sessionId).retainedBy,
						blank: entry.blank,
						updatedAt: entry.updatedAt,
						...entry.projectionValues === void 0 ? {} : { projectionValues: entry.projectionValues },
						...entry.title !== void 0 ? { title: entry.title } : {},
						...entry.cwd !== void 0 ? { cwd: entry.cwd } : {},
						...entry.parentSessionId !== void 0 ? { parentId: entry.parentSessionId } : {},
						...entry.origin !== void 0 ? { origin: entry.origin } : {}
					};
				}
				for (const [parentId, projection] of Object.entries(projectionsBySession)) for (const child of projection.values.subagentCatalog ?? []) {
					const childId = child.id;
					const summary = byId[childId];
					const projectionValues = summary?.projectionValues ?? this.manager.projectionValues(childId);
					const projectedTitle = projectionValues?.title;
					const title = typeof projectedTitle === "string" && projectedTitle !== "" ? projectedTitle : void 0;
					const displayTitle = title ?? child.label ?? childId;
					if (summary === void 0) byId[childId] = {
						id: childId,
						displayTitle,
						parentId,
						origin: "subagent",
						running: this.scopes.get(childId)?.session.getSnapshot().running ?? false,
						blank: false,
						updatedAt: 0,
						retainedBy: this.retentionSnapshot(childId).retainedBy,
						...projectionValues === void 0 ? {} : { projectionValues },
						...title === void 0 ? {} : { title }
					};
					else if (summary.displayTitle !== displayTitle || summary.projectionValues !== projectionValues) byId[childId] = {
						...summary,
						displayTitle,
						...projectionValues === void 0 ? {} : { projectionValues }
					};
				}
				for (const [id, record] of this.scopes) {
					if (byId[id] !== void 0) continue;
					const address = this.manager.subagentAddress(id);
					if (address === void 0) continue;
					const previous = previousById[id];
					const snapshot = record.session.getSnapshot();
					const projectionValues = this.manager.projectionValues(id);
					const projectedTitle = projectionValues?.title;
					const title = typeof projectedTitle === "string" && projectedTitle !== "" ? projectedTitle : previous?.title;
					byId[id] = {
						...previous ?? {
							id,
							displayTitle: id,
							updatedAt: 0
						},
						running: snapshot.running,
						retainedBy: record.retention.retainedBy,
						blank: snapshot.blank,
						parentId: address.parentSessionId,
						origin: "subagent",
						...projectionValues === void 0 ? {} : { projectionValues },
						...title === void 0 ? {} : {
							title,
							displayTitle: title
						}
					};
				}
				this.list.set({
					ids,
					byId,
					phase,
					projectionsBySession
				});
			}
			startScopeDrop(id, record, disposeFiber = true, sessionDisposal = this.manager.drop(id, record.session)) {
				const drop = this.dropScope(record, disposeFiber, sessionDisposal);
				this.scopeDrops.add(drop);
				drop.then(() => {
					this.scopeDrops.delete(drop);
				}, () => {
					this.scopeDrops.delete(drop);
				});
			}
			async drainScopeDrops() {
				while (this.scopeDrops.size > 0) await Promise.allSettled([...this.scopeDrops]);
			}
			/** Await the already-withdrawn Session and scoped cleanup to quiescence. */
			async dropScope(record, disposeFiber, sessionDisposal) {
				await Promise.allSettled([sessionDisposal, ...disposeFiber ? [record.fiber.dispose()] : []]);
			}
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Client Session object layer, Agent scopes, and Remote lifecycle wiring. */
		/** Required Remote and Context projection services. */
		const inject = [
			"connection",
			"fileUpload",
			"typert",
			"remote",
			"remote.commands",
			"remote.session",
			"remote.subagents"
		];
		/**
		* Install Client Session state and its reconnecting control stream.
		* @param ctx - Client Cordis context.
		*/
		function apply(ctx) {
			const remotes = ctx.remote;
			const connection = ctx.get("connection");
			const sessions = new ClientSessions(ctx, remotes);
			ctx.remote.$on("api-session/added", (summary) => {
				sessions.handleSessionAdded(summary);
			});
			ctx.remote.$on("api-session/removed", (sessionId) => {
				sessions.handleSessionRemoved(sessionId);
			});
			ctx.remote.$on("api-session/status", (sessionId, running) => {
				sessions.handleSessionStatus(sessionId, running);
			});
			ctx.remote.$on("api-session/activity", (sessionId, updatedAt) => {
				sessions.handleSessionActivity(sessionId, updatedAt);
			});
			ctx.remote.$on("api-session/error", (sessionId, message) => {
				sessions.handleSessionError(sessionId, message);
			});
			const control = createSessionControlStream(remotes, {
				accept: (frame) => {
					sessions.handleControlFrame(frame);
				},
				failed: (error) => {
					console.error("[session-controller] control stream failed:", error);
				}
			});
			const connected = () => {
				if (connection.generation.getSnapshot() === void 0) return;
				sessions.handleConnected();
				control.restart();
				control.start();
			};
			ctx.effect(() => connection.generation.subscribe(connected), "session-controller.client.generation");
			connected();
			ctx.typert.contexts.registerClient("agent", {
				identity: (candidate) => sessions.sessionOf(candidate)?.sessionId,
				resolve: (sessionId) => {
					const reference = sessions.retainAgentScope(sessionId);
					return typertOwnedValue(reference.binding.ctx, () => {
						reference.release();
					});
				}
			});
			ctx.effect(() => async () => {
				await control.dispose();
			}, "session-controller.client.control");
		}
		//#endregion
		exports.MutableSessionEventSource = MutableSessionEventSource;
		exports.SESSION_SEARCH_RESULT_LIMIT = SESSION_SEARCH_RESULT_LIMIT;
		exports.SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS;
		exports.SessionCreateError = SessionCreateError;
		exports.SessionEventStream = SessionEventStream;
		exports.SessionForkError = SessionForkError;
		exports.apply = apply;
		exports.createScope = createScope;
		exports.createSessionControlStream = createSessionControlStream;
		exports.inject = inject;
		exports.scopeOf = scopeOf;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-directory-picker-native",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region lib/types/client/flow.js
		/**
		* The native picking occupant (package-internal; the `./client` surface
		* exposes only the Loader exports). Same-package tests exercise it directly
		* through this module.
		*/
		/**
		* Renderless flow occupant: each rising `open` edge runs exactly one pick and
		* reports exactly one outcome; the ref arms once per open so re-renders (and
		* an adoption keeping `open` true while `busy`) never launch a second
		* chooser. The owner withdrawing `open` re-arms the next request.
		* @param props - owner conversation plus the injected pick call.
		* @returns nothing — the native chooser renders on the host display.
		*/
		function NativeDirectoryFlow(props) {
			const { open, pick } = props;
			const armed = (0, react.useRef)(false);
			const outcome = (0, react.useRef)(props);
			outcome.current = props;
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!open) {
					armed.current = false;
					return;
				}
				if (armed.current) return;
				armed.current = true;
				pick().then((path) => {
					if (!alive.current) return;
					if (path === null) outcome.current.onCancel();
					else outcome.current.onPicked(path);
				}, (reason) => {
					if (!alive.current) return;
					outcome.current.onError(reason instanceof Error ? reason.message : String(reason));
				});
			}, [open, pick]);
			return null;
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Required services (cordis fiber inject): the slot registry and workspace UI service. */
		const inject = ["slots", "uiWorkspace"];
		/**
		* Client plugin body: register the renderless native flow into both
		* directory-flow holes through `slots.inject()` because the ui-workspace
		* entries may activate later or replace their declarations.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const desktop = globalThis.__DSH_DIRECTORY_PICKER__;
			const pick = desktop === void 0 ? () => ctx.uiWorkspace.pickDirectory() : () => desktop.pick();
			const injected = () => ({ pick });
			ctx.slots.inject("conversation.hero.workspace.directoryFlow", () => ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
				yield ctx.slots.register({
					name: "conversation.hero.workspace.directoryFlow",
					inject: injected
				}, NativeDirectoryFlow);
				yield ctx.slots.register({
					name: "sidebar.workspaces.directoryFlow",
					inject: injected
				}, NativeDirectoryFlow);
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
;
//# sourceMappingURL=??@deepseek-ai/dsh-client-file-upload/client.js.map,@deepseek-ai/dsh-api-remotes/client.js.map,@deepseek-ai/dsh-client-ui-deliverables/client.js.map,@deepseek-ai/dsh-typert-registry/client.js.map,@deepseek-ai/dsh-client-connection/client.js.map,@deepseek-ai/dsh-api-workspace-controller/client.js.map,@deepseek-ai/dsh-api-session-controller/client.js.map,@deepseek-ai/dsh-client-ui-directory-picker-native/client.js.map&rev=680b522cc713
