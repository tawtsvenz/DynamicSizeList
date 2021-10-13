import React, { createElement, useEffect, useRef } from "react";

import { VariableSizeList as List } from "react-window";

// override list method
const defaultItemKey = (index, data) => index;

// override list method
const getEstimatedTotalSize = (
  { itemCount },
  { itemMetadataMap, estimatedItemSize, lastMeasuredIndex }
) => {
  let totalSizeOfMeasuredItems = 0;

  // Edge case check for when the number of items decreases while a scroll is in progress.
  // https://github.com/bvaughn/react-window/pull/138
  if (lastMeasuredIndex >= itemCount) {
    lastMeasuredIndex = itemCount - 1;
  }

  if (lastMeasuredIndex >= 0) {
    const itemMetadata = itemMetadataMap[lastMeasuredIndex];
    totalSizeOfMeasuredItems = itemMetadata.offset + itemMetadata.size;
  }

  const numUnmeasuredItems = itemCount - lastMeasuredIndex - 1;
  const totalSizeOfUnmeasuredItems = numUnmeasuredItems * estimatedItemSize;

  return totalSizeOfMeasuredItems + totalSizeOfUnmeasuredItems;
};

// override list method
function render(fixOverlaps) {
  const {
    children,
    className,
    direction,
    height,
    innerRef,
    innerElementType,
    innerTagName,
    itemCount,
    itemData,
    itemKey = defaultItemKey,
    layout,
    outerElementType,
    outerTagName,
    style,
    useIsScrolling,
    width
  } = this.props;
  const { isScrolling, scrollDirection, scrollOffset } = this.state;

  // TODO Deprecate direction "horizontal"
  const isHorizontal = direction === "horizontal" || layout === "horizontal";

  const onScroll = isHorizontal
    ? this._onScrollHorizontal
    : this._onScrollVertical;

  const [startIndex, stopIndex, visibleStartIndex, visibleStopIndex] = this._getRangeToRender();

  const itemMetadataMap = this._instanceProps.itemMetadataMap;
  if (itemMetadataMap[startIndex]) {
    const fromEnd = scrollDirection.localeCompare("backward") === 0;
    // from from visible to overscan depending on direction of scroll
    const fixStartIndex = fromEnd ? startIndex : visibleStartIndex;
    const fixStopIndex = fromEnd ? visibleStopIndex : stopIndex;
    const anchorIndex = fromEnd ? fixStopIndex : fixStartIndex;
    const oldOffset = itemMetadataMap[anchorIndex].offset;
    const fixed = fixOverlaps(
      itemCount,
      itemMetadataMap,
      fixStartIndex,
      fixStopIndex,
      fromEnd,
    );
    if (fixed) {
      // forget styles
      this._getItemStyleCache(-1);
      // adjust position if changed to keep visible item in view
      const newOffset = itemMetadataMap[anchorIndex].offset;
      this.setState({
        scrollDirection: scrollDirection,
        scrollOffset: scrollOffset + (newOffset - oldOffset),
        scrollUpdateWasRequested: true,
      });
    }
  }

  const items = [];
  if (itemCount > 0) {
    for (let index = startIndex; index <= stopIndex; index++) {
      items.push(
        createElement(children, {
          data: itemData,
          key: itemKey(index, itemData),
          index,
          isScrolling: useIsScrolling ? isScrolling : undefined,
          style: this._getItemStyle(index)
        })
      );
    }
  }

  // Read this value AFTER items have been created,
  // So their actual sizes (if variable) are taken into consideration.
  const estimatedTotalSize = getEstimatedTotalSize(
    this.props,
    this._instanceProps
  );

  return createElement(
    outerElementType || outerTagName || "div",
    {
      className,
      onScroll,
      ref: this._outerRefSetter,
      style: {
        position: "relative",
        height,
        width,
        overflow: "auto",
        WebkitOverflowScrolling: "touch",
        willChange: "transform",
        direction,
        ...style
      }
    },
    createElement(innerElementType || innerTagName || "div", {
      children: items,
      ref: innerRef,
      style: {
        height: isHorizontal ? "100%" : estimatedTotalSize,
        pointerEvents: isScrolling ? "none" : undefined,
        width: isHorizontal ? estimatedTotalSize : "100%"
      }
    })
  );
}

function IndexedListItem(props) {
  //required props: index, style, onSetSize, childCreationCallback
  const onSetSize = props.onSetSize;
  const childRef = useRef(null);
  const widthRef = useRef(0);
  const heightRef = useRef(0);
  useEffect(() => {
    if (childRef.current) {
      const node = childRef.current;
      if (node) {
        if (onSetSize) {
          onSetSize(props.index, node);
        }
      }
      try {
        const resizeObserver = new ResizeObserver(() => {
          if (
            onSetSize &&
            ((node.offsetHeight > 0 &&
              node.offsetHeight !== heightRef.current) ||
              (node.offsetWidth > 0 && node.offsetWidth !== widthRef.current))
          ) {
            heightRef.current = node.offsetHeight;
            widthRef.current = node.offsetWidth;
            onSetSize(props.index, node);
          }
        });
        resizeObserver.observe(node);
        return () => resizeObserver.unobserve(node);
      } catch (e) {
        console.log("ResizeObserver API not available");
      }
    }
    // eslint-disable-next-line
  }, [childRef]);

  return (
    <span style={{ ...props.style }}>
      {props.childCreationCallback(props.index, childRef)}
    </span>
  );
}

export default function DynamicSizeList(props) {
  // props: componentRef, scrollFromEnd, [other VariableSizeList props]
  // will override ref and itemSize props.
  const listRef = useRef();

  useEffect(() => {
    if (listRef.current) {
      // give parent the list ref
      const node = listRef.current;
      if (props.componentRef) props.componentRef.current = node;
      // patch render method
      const boundRender = render.bind(node);
      Object.getPrototypeOf(node).render = () => boundRender(fixOverlaps);
    }
    // eslint-disable-next-line
  }, [listRef]);

  // scroll to end on first items population if props say we should start from end
  const firstScrollRef = useRef(false);
  useEffect(() => {
    if (
      !firstScrollRef.current &&
      props.itemCount > 0 &&
      listRef.current &&
      props.scrollFromEnd
    ) {
      const node = listRef.current;
      node.scrollToItem(props.itemCount - 2);
      firstScrollRef.current = true;
    }
  }, [props.itemCount, props.scrollFromEnd, listRef]);

  function pushAboveZero(itemMetadataMap, index, endIndex) {
    const pushValue = 0 - itemMetadataMap[index].offset;
    if (pushValue < 0) return;
    for (let i = index; i <= endIndex; i++) {
      if (!itemMetadataMap[i]) break;
      itemMetadataMap[i].offset += pushValue;
    }
  }

  const fixingRef = useRef(false);
  // eslint-disable-next-line no-unused-vars
  function fixOverlaps(
    itemCount,
    itemMetadataMap,
    fromIndex,
    endIndex,
    fromEnd
  ) {
    let fixed = false;

    // skip fixing if already doing it
    if (fixingRef.current) return fixed;
    else fixingRef.current = true;

    if (!fromEnd) {
      for (let i = fromIndex; i < endIndex + 1; i++) {
        if (i === fromIndex) continue;
        if (i < 0) continue;
        if (i >= itemCount) break;
        const currentItemData = itemMetadataMap[i];
        if (!currentItemData) continue;
        const prevItemData = itemMetadataMap[i - 1];
        if (!prevItemData) continue;
        const currentOffset = currentItemData.offset;
        const prevItemEndOffset = prevItemData.offset + prevItemData.size;
        if (prevItemEndOffset !== currentOffset) {
          // move to end of prev item
          fixed = true;
          currentItemData.offset = prevItemEndOffset;
        }
      }
    } else {
      let indexBelowZero = -1;
      for (let i = endIndex; i >= fromIndex; i--) {
        if (i > endIndex) continue;
        if (i < 0) break;
        if (i >= itemCount) continue;
        const currentItemData = itemMetadataMap[i];
        if (!currentItemData) continue;
        const prevItemData = itemMetadataMap[i + 1];
        if (!prevItemData) continue;
        const currentEndOffset = currentItemData.offset + currentItemData.size;
        const prevItemOffset = prevItemData.offset;
        if (currentEndOffset !== prevItemOffset) {
          // move to end of prev item
          fixed = true;
          currentItemData.offset = prevItemOffset - currentItemData.size;
          if (currentItemData.offset < 0) {
            indexBelowZero = i;
          }
        }
      }
      if (indexBelowZero >= 0) {
        pushAboveZero(itemMetadataMap, indexBelowZero, endIndex + 1);
      }
    }
    fixingRef.current = false;
    return fixed;
  }

  function setSize(index, node) {
    const list = listRef.current;
    if (!list || index < 0) return;
    const { direction, layout } = list.props;
    const isHorizontal = direction === "horizontal" || layout === "horizontal";
    const newDimension = isHorizontal ? node.offsetWidth : node.offsetHeight;

    const itemMetadataMap = list._instanceProps.itemMetadataMap;
    if (newDimension > 0 && itemMetadataMap[index].size !== newDimension) {
      const currentItemData = itemMetadataMap[index];
      itemMetadataMap[index] = {
        offset: currentItemData.offset,
        size: newDimension
      };
    }
  }

  function getItemSize(index) {
    let item = null;
    if (listRef.current) {
      const list = listRef.current;
      const itemMetadataMap = list._instanceProps.itemMetadataMap;
      item = itemMetadataMap[index];
    }
    const savedSize = item ? item.size : 0;
    return savedSize ? savedSize : 50;
  }

  return (
    <List {...props} ref={listRef} itemSize={getItemSize}>
      {({ index, style }) => {
        return (
          <IndexedListItem
            index={index}
            style={style}
            onSetSize={setSize}
            childCreationCallback={props.children}
          />
        );
      }}
    </List>
  );
}