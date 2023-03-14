import { SimpleParser, TransformVisitor } from "visitor-as";
import {
    ClassDeclaration,
    DiagnosticEmitter,
    DiagnosticCode,
    FieldDeclaration,
    CommonFlags,
} from "assemblyscript/dist/assemblyscript.js";
import { toString, isMethodNamed } from "visitor-as/dist/utils.js";
import _ from "lodash";
import {
    METHOD_DES,
    METHOD_DES_ARG_NAME,
    METHOD_DES_FIELD,
    METHOD_DES_LAST_FIELD,
    METHOD_DES_SIG,
    METHOD_END_DES_FIELD,
    METHOD_START_DES_FIELD,
} from "../consts.js";
import { getNameNullable } from "../utils.js";
import { SerdeConfig, DeserializeNode } from "../ast.js";

export class DeserializeVisitor extends TransformVisitor {
    private fields: FieldDeclaration[] = [];
    private hasBase: bool = false;
    private de!: DeserializeNode;
    // Use the externalDe to replace `de` if it exist.
    readonly externalDe: DeserializeNode | null = null;

    constructor(
        public readonly emitter: DiagnosticEmitter,
        externalCfg: SerdeConfig | null = null,
    ) {
        super();
        if (externalCfg != null) {
            this.externalDe = new DeserializeNode(externalCfg);
        }
    }

    visitFieldDeclaration(node: FieldDeclaration): FieldDeclaration {
        if (node.is(CommonFlags.Static)) {
            return node;
        }
        this.fields.push(node);
        return node;
    }

    visitClassDeclaration(node: ClassDeclaration): ClassDeclaration {
        // user customed
        if (node.members.some(isMethodNamed(METHOD_DES))) {
            return node;
        }
        this.hasBase = node.extendsType ? true : false;
        if (this.externalDe) {
            this.de = this.externalDe;
        } else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.de = DeserializeNode.extractFromDecoratorNode(this.emitter, node)!;
        }
        super.visitClassDeclaration(node);
        // for fields declared in constructor
        this.fields = _.uniqBy(this.fields, (f) => f);
        const lastField = this.fields[this.fields.length - 1];
        const fields = this.fields.slice(0, -1);
        const stmts = fields
            .map((f) => this.genStmtForField(f))
            .filter((elem) => elem != null) as string[];

        if (this.hasBase && !this.de.skipSuper) {
            stmts.unshift(`super.deserialize<__S>(deserializer);`);
        }

        if (lastField) {
            const lastFieldStmt = this.genStmtForLastField(lastField);
            if (lastFieldStmt) {
                stmts.push(lastFieldStmt);
            }
        }
        stmts.unshift(`deserializer.${METHOD_START_DES_FIELD}();`);
        stmts.push(`deserializer.${METHOD_END_DES_FIELD}();`);
        stmts.push(`return this;`);
        const methodDecl = `
${METHOD_DES_SIG} { 
    ${stmts.join("\n")} 
}`;

        const methodNode = SimpleParser.parseClassMember(methodDecl, node);
        node.members.push(methodNode);
        return node;
    }

    protected genStmtForField(node: FieldDeclaration): string | null {
        const name = toString(node.name);
        const nameStr = this.de.omitName ? "null" : `"${name}"`;
        if (!node.type) {
            this.emitter.error(
                DiagnosticCode.User_defined_0,
                node.range,
                `serde-as: field '${name}' need a type declaration`,
            );
            return null;
        } else {
            const ty = getNameNullable(node.type);
            return `this.${name} = ${METHOD_DES_ARG_NAME}.${METHOD_DES_FIELD}<${ty}>(${nameStr});`;
        }
    }

    protected genStmtForLastField(node: FieldDeclaration): string | null {
        const name = toString(node.name);
        const nameStr = this.de.omitName ? "null" : `"${name}"`;
        if (!node.type) {
            this.emitter.error(
                DiagnosticCode.User_defined_0,
                node.range,
                `serde-as: field '${name}' need a type declaration`,
            );
            return null;
        } else {
            const ty = getNameNullable(node.type);
            return [`this.${name} = ${METHOD_DES_ARG_NAME}.${METHOD_DES_LAST_FIELD}<${ty}>(${nameStr});`].join(
                "\n",
            );
        }
    }
}
