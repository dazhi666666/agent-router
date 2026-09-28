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
		/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
		function hasIntrinsicConstructor(prototype, name) {
			const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
			if (typeof constructor !== "function") return false;
			try {
				return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
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
//# sourceMappingURL=??@deepseek-ai/dsh-typert-registry/client.js.map,@deepseek-ai/dsh-client-connection/client.js.map,@deepseek-ai/dsh-api-workspace-controller/client.js.map,@deepseek-ai/dsh-api-session-controller/client.js.map,@deepseek-ai/dsh-client-ui-directory-picker-native/client.js.map&rev=0e491faa718a
