import ast
import re
from enum import Enum

from scraping.models import SearchEngineType
from utils.logger import Logger

log = Logger(__name__)

class SearchQueryOperator(str, Enum):
    AND = "AND"
    OR = "OR"
    NOT = "NOT"

class SearchQueryParser:
    """
    A class to parse search queries.
    Supported operators: AND, OR, NOT
    Supported formats: Semantic Scholar, DBLP, Web of Science

    Attributes:
    expr (str): The search query to parse.
    tree (ast.AST): The abstract syntax tree of the search query
    """

    def __init__(self, expr: str):
        self.WILDCARD = "_WILDCARD_"
        normalized_expr = re.sub(r"\bAND\b", "and", expr, flags=re.IGNORECASE)
        normalized_expr = re.sub(r"\bOR\b", "or", normalized_expr, flags=re.IGNORECASE)
        normalized_expr = re.sub(r"\bNOT\b", "not", normalized_expr, flags=re.IGNORECASE)
        sanitized_expr = normalized_expr.replace("*", self.WILDCARD)
        self.expr = sanitized_expr
        self.tree = ast.parse(sanitized_expr, mode='eval').body

    def parse(self, format_type) -> str:
        """ 
        Main method to parse the search query. 

        >>> expr = "A and B and C and (D or E and not F)"
        >>> parser = SearchQueryParser(expr)
        >>> parser.parse("SEMANTIC_SCHOLAR")
        "A + B + C + (D | E - F)"
        """
        expression = self._build_expression(self.tree, format_type)
        expression = self._format_wildcards(expression, format_type)
        return expression

    
    def _build_expression(self, node: ast.AST, format_type: SearchEngineType) -> str:
        """ 
        Recursively build the search expression. 
        
        Args:
            node (ast.AST): The current node in the AST.
            format_type (str): The format type to generate the search string for.
        """
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                return self._format_operator(SearchQueryOperator.AND, node.values, format_type)
            elif isinstance(node.op, ast.Or):
                return self._format_operator(SearchQueryOperator.OR, node.values, format_type)
            
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return self._format_not_operator(self._build_expression(node.operand, format_type), format_type)
        
        elif isinstance(node, ast.Name):
            return self._format_phrase(node.id, format_type)
        
        elif isinstance(node, ast.Constant):  # Handles phrases
            return self._format_phrase(node.value, format_type)
        
        elif isinstance(node, ast.Str):  # Handles string literals (Python < 3.8)
            return self._format_phrase(node.s, format_type)
        
        else:
            raise ValueError("Unsupported expression node")
    

    def _is_parenthesized(self, node: ast.AST) -> bool:
        """Return True if the original expression had parentheses directly around this node.

        This checks the character immediately before and after the node's source span
        in self.expr for '(' and ')'. Works best for single-line expressions (the
        parser uses mode='eval'). If location info isn't available, conservatively
        return False.
        """
        try:
            start = node.col_offset
            end = node.end_col_offset
        except AttributeError:
            return False
        # Guard bounds
        if start is None or end is None or start < 0 or end > len(self.expr):
            return False
        # Find previous non-space character before start
        i = start - 1
        while i >= 0 and self.expr[i].isspace():
            i -= 1
        if i < 0 or self.expr[i] != '(':
            return False
        # Find next non-space character after end
        j = end
        while j < len(self.expr) and self.expr[j].isspace():
            j += 1
        if j >= len(self.expr) or self.expr[j] != ')':
            return False
        return True

    def _format_operator(self, operator: SearchQueryOperator, operands: list, format_type: SearchEngineType) -> str:
        """ 
        Format the operator and operands based on the format type.

        Args:
            operator (str): The operator to format.
            operands (list): The operands to format (AST nodes).
            format_type (str): The format type to generate the search string for.
        """
        formatted_operands = []
        for op in operands:
            formatted = self._build_expression(op, format_type)
            # Preserve any parentheses the user originally provided around this operand
            if self._is_parenthesized(op):
                # Avoid double-wrapping if already parenthesized in the output
                if not (formatted.startswith("(") and formatted.endswith(")")):
                    formatted = f"({formatted})"
            formatted_operands.append(formatted)

        if format_type == SearchEngineType.SEMANTIC_SCHOLAR:
            if operator == SearchQueryOperator.AND:
                joined_operands = " + ".join(formatted_operands)
            elif operator == SearchQueryOperator.OR:
                joined_operands = " | ".join(formatted_operands)

        elif format_type == SearchEngineType.DBLP:
            if operator == SearchQueryOperator.AND:
                joined_operands = " ".join(formatted_operands)
            elif operator == SearchQueryOperator.OR:
                joined_operands = " | ".join(formatted_operands)

        elif format_type == SearchEngineType.WEB_OF_SCIENCE:
            if operator == SearchQueryOperator.AND:
                joined_operands = " AND ".join(formatted_operands)
            elif operator == SearchQueryOperator.OR:
                joined_operands = " OR ".join(formatted_operands)

        elif (
            format_type == SearchEngineType.IEEE_XPLORE or
            format_type == SearchEngineType.SCOPUS
        ):
            if operator == SearchQueryOperator.AND:
                joined_operands = " AND ".join(formatted_operands)
            elif operator == SearchQueryOperator.OR:
                joined_operands = " OR ".join(formatted_operands)
        
        # Add parentheses around the entire OR expression to ensure precedence
        if operator == SearchQueryOperator.OR:
            return f"({joined_operands})"
        
        return joined_operands
    
    def _format_not_operator(self, operand: str, format_type: SearchEngineType) -> str:
        if format_type == SearchEngineType.SEMANTIC_SCHOLAR:
            return f"-{operand}"
        elif format_type == SearchEngineType.DBLP:
            return f"-{operand}"  # Assuming no specific NOT syntax, fallback to minus
        elif (
            format_type == SearchEngineType.WEB_OF_SCIENCE or 
            format_type == SearchEngineType.IEEE_XPLORE or
            format_type == SearchEngineType.SCOPUS
        ):
            return f"NOT {operand}"

    def _format_phrase(self, phrase: str, format_type: SearchEngineType) -> str:
        if format_type == SearchEngineType.SEMANTIC_SCHOLAR:
            if self.WILDCARD in phrase:
                phrase = phrase.replace(self.WILDCARD, "*")
            if "*" in phrase:
                return f'{phrase}'  # Do not add quotes if it contains a wildcard
            return f'"{phrase}"'
        if format_type == SearchEngineType.DBLP:
            return f'{phrase}$'  # Append $ for DBLP
        if format_type == SearchEngineType.WEB_OF_SCIENCE:
            return f'"{phrase}"'
        if format_type == SearchEngineType.IEEE_XPLORE:
            return f'"{phrase}"'
        if format_type == SearchEngineType.SCOPUS:
            if " " in phrase:
                return f'{{{phrase}}}'
            return phrase
        
    def _format_wildcards(self, expression: str, format_type: SearchEngineType) -> str:
        return expression.replace(self.WILDCARD, "*")