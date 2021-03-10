"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenApiValidator = exports.Forbidden = exports.Unauthorized = exports.NotFound = exports.NotAcceptable = exports.MethodNotAllowed = exports.BadRequest = exports.RequestEntityTooLarge = exports.UnsupportedMediaType = exports.InternalServerError = void 0;
const ono_1 = require("ono");
const express = require("express");
const _uniq = require("lodash.uniq");
const middlewares = require("./middlewares");
const openapi_context_1 = require("./framework/openapi.context");
const resolvers_1 = require("./resolvers");
const base_serdes_1 = require("./framework/base.serdes");
const schema_preprocessor_1 = require("./middlewares/parsers/schema.preprocessor");
const options_1 = require("./framework/ajv/options");
var types_1 = require("./framework/types");
Object.defineProperty(exports, "InternalServerError", { enumerable: true, get: function () { return types_1.InternalServerError; } });
Object.defineProperty(exports, "UnsupportedMediaType", { enumerable: true, get: function () { return types_1.UnsupportedMediaType; } });
Object.defineProperty(exports, "RequestEntityTooLarge", { enumerable: true, get: function () { return types_1.RequestEntityTooLarge; } });
Object.defineProperty(exports, "BadRequest", { enumerable: true, get: function () { return types_1.BadRequest; } });
Object.defineProperty(exports, "MethodNotAllowed", { enumerable: true, get: function () { return types_1.MethodNotAllowed; } });
Object.defineProperty(exports, "NotAcceptable", { enumerable: true, get: function () { return types_1.NotAcceptable; } });
Object.defineProperty(exports, "NotFound", { enumerable: true, get: function () { return types_1.NotFound; } });
Object.defineProperty(exports, "Unauthorized", { enumerable: true, get: function () { return types_1.Unauthorized; } });
Object.defineProperty(exports, "Forbidden", { enumerable: true, get: function () { return types_1.Forbidden; } });
class OpenApiValidator {
    constructor(options) {
        this.validateOptions(options);
        this.normalizeOptions(options);
        if (options.validateApiSpec == null)
            options.validateApiSpec = true;
        if (options.validateRequests == null)
            options.validateRequests = true;
        if (options.validateResponses == null)
            options.validateResponses = false;
        if (options.validateSecurity == null)
            options.validateSecurity = true;
        if (options.fileUploader == null)
            options.fileUploader = {};
        if (options.$refParser == null)
            options.$refParser = { mode: 'bundle' };
        if (options.unknownFormats == null)
            options.unknownFormats === true;
        if (options.validateFormats == null)
            options.validateFormats = 'fast';
        if (options.formats == null)
            options.formats = [];
        if (typeof options.operationHandlers === 'string') {
            /**
             * Internally, we want to convert this to a value typed OperationHandlerOptions.
             * In this way, we can treat the value as such when we go to install (rather than
             * re-interpreting it over and over).
             */
            options.operationHandlers = {
                basePath: options.operationHandlers,
                resolver: resolvers_1.defaultResolver,
            };
        }
        else if (typeof options.operationHandlers !== 'object') {
            // This covers cases where operationHandlers is null, undefined or false.
            options.operationHandlers = false;
        }
        if (options.validateResponses === true) {
            options.validateResponses = {
                removeAdditional: false,
                coerceTypes: false,
                onError: null,
            };
        }
        if (options.validateRequests === true) {
            options.validateRequests = {
                allowUnknownQueryParameters: false,
                coerceTypes: false,
            };
        }
        if (options.validateSecurity === true) {
            options.validateSecurity = {};
        }
        this.options = options;
        this.ajvOpts = new options_1.AjvOptions(options);
    }
    installMiddleware(spec) {
        const middlewares = [];
        const pContext = spec
            .then((spec) => {
            const apiDoc = spec.apiDoc;
            const ajvOpts = this.ajvOpts.preprocessor;
            const resOpts = this.options.validateResponses;
            const sp = new schema_preprocessor_1.SchemaPreprocessor(apiDoc, ajvOpts, resOpts).preProcess();
            return {
                context: new openapi_context_1.OpenApiContext(spec, this.options.ignorePaths),
                responseApiDoc: sp.apiDocRes,
                error: null,
            };
        })
            .catch((e) => {
            return {
                context: null,
                responseApiDoc: null,
                error: e,
            };
        });
        let inited = false;
        // install path params
        middlewares.push((req, res, next) => pContext
            .then(({ context, error }) => {
            // Throw if any error occurred during spec load.
            if (error)
                throw error;
            if (!inited) {
                // Would be nice to pass the current Router object here if the route
                // is attach to a Router and not the app.
                // Doing so would enable path params to be type coerced when provided to
                // the final middleware.
                // Unfortunately, it is not possible to get the current Router from a handler function
                this.installPathParams(req.app, context);
                inited = true;
            }
            next();
        })
            .catch(next));
        // metadata middleware
        let metamw;
        middlewares.push((req, res, next) => pContext
            .then(({ context, responseApiDoc }) => {
            metamw = metamw || this.metadataMiddlware(context, responseApiDoc);
            return metamw(req, res, next);
        })
            .catch(next));
        if (this.options.fileUploader) {
            // multipart middleware
            let fumw;
            middlewares.push((req, res, next) => pContext
                .then(({ context: { apiDoc } }) => {
                fumw = fumw || this.multipartMiddleware(apiDoc);
                return fumw(req, res, next);
            })
                .catch(next));
        }
        // security middlware
        let scmw;
        middlewares.push((req, res, next) => pContext
            .then(({ context: { apiDoc } }) => {
            const components = apiDoc.components;
            if (this.options.validateSecurity && (components === null || components === void 0 ? void 0 : components.securitySchemes)) {
                scmw = scmw || this.securityMiddleware(apiDoc);
                return scmw(req, res, next);
            }
            else {
                next();
            }
        })
            .catch(next));
        // request middlweare
        if (this.options.validateRequests) {
            let reqmw;
            middlewares.push((req, res, next) => {
                return pContext
                    .then(({ context: { apiDoc } }) => {
                    reqmw = reqmw || this.requestValidationMiddleware(apiDoc);
                    return reqmw(req, res, next);
                })
                    .catch(next);
            });
        }
        // response middleware
        if (this.options.validateResponses) {
            let resmw;
            middlewares.push((req, res, next) => pContext
                .then(({ responseApiDoc }) => {
                resmw = resmw || this.responseValidationMiddleware(responseApiDoc);
                return resmw(req, res, next);
            })
                .catch(next));
        }
        // op handler middleware
        if (this.options.operationHandlers) {
            let router = null;
            middlewares.push((req, res, next) => {
                if (router)
                    return router(req, res, next);
                pContext
                    .then(({ context }) => (router = this.installOperationHandlers(req.baseUrl, context)))
                    .then((router) => router(req, res, next))
                    .catch(next);
            });
        }
        return middlewares;
    }
    installPathParams(app, context) {
        const pathParams = [];
        for (const route of context.routes) {
            if (route.pathParams.length > 0) {
                pathParams.push(...route.pathParams);
            }
        }
        // install param on routes with paths
        for (const p of _uniq(pathParams)) {
            app.param(p, (req, res, next, value, name) => {
                const openapi = req.openapi;
                if (openapi === null || openapi === void 0 ? void 0 : openapi.pathParams) {
                    const { pathParams } = openapi;
                    // override path params
                    req.params[name] = pathParams[name] || req.params[name];
                }
                next();
            });
        }
    }
    metadataMiddlware(context, responseApiDoc) {
        return middlewares.applyOpenApiMetadata(context, responseApiDoc);
    }
    multipartMiddleware(apiDoc) {
        return middlewares.multipart(apiDoc, {
            multerOpts: this.options.fileUploader,
            ajvOpts: this.ajvOpts.multipart,
        });
    }
    securityMiddleware(apiDoc) {
        var _a;
        const securityHandlers = (_a = (this.options.validateSecurity)) === null || _a === void 0 ? void 0 : _a.handlers;
        return middlewares.security(apiDoc, securityHandlers);
    }
    requestValidationMiddleware(apiDoc) {
        const requestValidator = new middlewares.RequestValidator(apiDoc, this.ajvOpts.request);
        return (req, res, next) => requestValidator.validate(req, res, next);
    }
    responseValidationMiddleware(apiDoc) {
        return new middlewares.ResponseValidator(apiDoc, this.ajvOpts.response, 
        // This has already been converted from boolean if required
        this.options.validateResponses).validate();
    }
    installOperationHandlers(baseUrl, context) {
        const router = express.Router({ mergeParams: true });
        this.installPathParams(router, context);
        for (const route of context.routes) {
            const { method, expressRoute } = route;
            /**
             * This if-statement is here to "narrow" the type of options.operationHandlers
             * to OperationHandlerOptions (down from string | false | OperationHandlerOptions)
             * At this point of execution it _should_ be impossible for this to NOT be the correct
             * type as we re-assign during construction to verify this.
             */
            if (this.isOperationHandlerOptions(this.options.operationHandlers)) {
                const { basePath, resolver } = this.options.operationHandlers;
                const path = expressRoute.indexOf(baseUrl) === 0
                    ? expressRoute.substring(baseUrl.length)
                    : expressRoute;
                router[method.toLowerCase()](path, resolver(basePath, route, context.apiDoc));
            }
        }
        return router;
    }
    validateOptions(options) {
        if (!options.apiSpec)
            throw ono_1.default('apiSpec required');
        const securityHandlers = options.securityHandlers;
        if (securityHandlers != null) {
            throw ono_1.default('securityHandlers is not supported. Use validateSecurities.handlers instead.');
        }
        if (options.coerceTypes) {
            console.warn('coerceTypes is deprecated.');
        }
        const multerOpts = options.multerOpts;
        if (multerOpts != null) {
            throw ono_1.default('multerOpts is not supported. Use fileUploader instead.');
        }
        const unknownFormats = options.unknownFormats;
        if (typeof unknownFormats === 'boolean') {
            if (!unknownFormats) {
                throw ono_1.default("unknownFormats must contain an array of unknownFormats, 'ignore' or true");
            }
        }
        else if (typeof unknownFormats === 'string' &&
            unknownFormats !== 'ignore' &&
            !Array.isArray(unknownFormats))
            throw ono_1.default("unknownFormats must contain an array of unknownFormats, 'ignore' or true");
    }
    normalizeOptions(options) {
        if (!options.serDes) {
            options.serDes = base_serdes_1.defaultSerDes;
        }
        else {
            if (!Array.isArray(options.unknownFormats)) {
                options.unknownFormats = Array();
            }
            options.serDes.forEach((currentSerDes) => {
                if (options.unknownFormats.indexOf(currentSerDes.format) ===
                    -1) {
                    options.unknownFormats.push(currentSerDes.format);
                }
            });
            base_serdes_1.defaultSerDes.forEach((currentDefaultSerDes) => {
                let defautSerDesOverride = options.serDes.find((currentOptionSerDes) => {
                    return currentDefaultSerDes.format === currentOptionSerDes.format;
                });
                if (!defautSerDesOverride) {
                    options.serDes.push(currentDefaultSerDes);
                }
            });
        }
    }
    isOperationHandlerOptions(value) {
        if (value.resolver) {
            return true;
        }
        else {
            return false;
        }
    }
}
exports.OpenApiValidator = OpenApiValidator;
//# sourceMappingURL=openapi.validator.js.map