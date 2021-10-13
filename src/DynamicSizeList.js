import React, { createElement } from "react";

import { VariableSizeList } from "react-window";

// override since not exposed in api
const defaultItemKey = (index, data) => index;
const shouldResetStyleCacheOnItemSizeChange = false;

//paste override since not exposed in api
const getItemMetadata = (
  props,
  index,
  instanceProps
) => {
  const { itemSize } = ((props));
  const { itemMetadataMap, lastMeasuredIndex } = instanceProps;

  if (index > lastMeasuredIndex) {
    let offset = 0;
    if (lastMeasuredIndex >= 0) {
      const itemMetadata = itemMetadataMap[lastMeasuredIndex];
      offset = itemMetadata.offset + itemMetadata.size;
    }

    for (let i = lastMeasuredIndex + 1; i <= index; i++) {
      let size = ((itemSize))(i);

      itemMetadataMap[i] = {
        offset,
        size,
      };

      offset += size;
    }

    instanceProps.lastMeasuredIndex = index;
  }

  return itemMetadataMap[index];
};

const getItemOffset = (
  props,
  index,
  instanceProps
) => getItemMetadata(props, index, instanceProps).offset;

const binarySearch = (
  props,
  instanceProps,
  high,
  low,
  offset
) => {
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const currentOffset = getItemMetadata(props, middle, instanceProps).offset;

    if (currentOffset === offset) {
      return middle;
    } else if (currentOffset < offset) {
      low = middle + 1;
    } else if (currentOffset > offset) {
      high = middle - 1;
    }
  }
  return null;
/*
  if (low > 0) {
    return low - 1;
  } else {
    return 0;
  }*/
};

class IndexedListItem extends React.Component {
  //required props: index, style, onSetSize, childCreationCallback
  constructor(props) {
    super(props);
    this.width = 0;
    this.height = 0;
    this.childRef = React.createRef();
    this.resizeObserver = null;
  }

  componentDidMount() {
    if (this.childRef.current) {
      const node = this.childRef.current;
      const onSetSize = this.props.onSetSize;
      if (node) {
        if (onSetSize) {
          onSetSize(this.props.index, node);
        }
      }
      try {
        this.resizeObserver = new ResizeObserver(() => {
          if (
            onSetSize &&
            ((node.offsetHeight > 0 &&
              node.offsetHeight !== this.height) ||
              (node.offsetWidth > 0 && node.offsetWidth !== this.width))
          ) {
            this.height = node.offsetHeight;
            this.width = node.offsetWidth;
            onSetSize(this.props.index, node);
          }
        });
        this.resizeObserver.observe(node);
      } catch (e) {
        //console.log("ResizeObserver API not available");
      }
    }
  }
  componentWillUnmount() {
    if (this.resizeObserver) {
      this.resizeObserver.unobserve(this.childRef.current);
    }
  }

  render() {
    return <span style={{ ...this.props.style }}>
      {this.props.childCreationCallback(this.props.index, this.childRef)}
    </span>
  }
}

export default class DynamicSizeList extends VariableSizeList {
  // props: componentRef, scrollFromEnd, [other VariableSizeList props]
  // will override ref and itemSize props.

  constructor(props) {
    super(props);
    this.firstScrollDone = false;
    this.fixingInProgress = false;
    this.measuredItemsCount = 0;
    this.measuredItemsDict = {};
    this.totalMeasuredSize = 0;
    //increment it with setState to request an update. Especially usefull after children change sizes.
    this.state.stateCounter = 0;
       
  }

  requestUpdate() {
    this.setState(prevState => ({ stateCounter: prevState.stateCounter + 1}));
  }

  componentDidMount() {
    super.componentDidMount();
    // give parent the list ref
    if (this.props.componentRef) this.props.componentRef.current = this;
  }

  componentDidUpdate() {
    super.componentDidUpdate();

    const itemMetadataMap = this._instanceProps.itemMetadataMap;
    const [startIndex, stopIndex, visibleStartIndex, visibleStopIndex] = this._getRangeToRender();
    // scroll to end on first items population if props say we should start from end
    if (
      !this.firstScrollDone &&
      this.props.itemCount > 0 &&
      this.props.scrollFromEnd
    ) {
      if (this.props.scrollFromEnd) {
        const lastItem = getItemMetadata(this.props, this.props.itemCount - 1, this._instanceProps);
        const endOffset = lastItem.offset + lastItem.size;
        if (this.props.itemCount - 1 > visibleStopIndex) {
          //Not near enough yet
          this.scrollTo(endOffset);
        } else {
          this.firstScrollDone = true;
        }
      } else {
        this.firstScrollDone = true;
      }
    }

    // fix overlaps after update
    const itemCount = this.props.itemCount;
    const { scrollDirection } = this.state;
    if (itemMetadataMap[startIndex]) {
      const fromEnd = scrollDirection.localeCompare("backward") === 0;
      // from from visible to overscan depending on direction of scroll
      const fixStartIndex = fromEnd ? startIndex : visibleStartIndex;
      const fixStopIndex = fromEnd ? visibleStopIndex : stopIndex;
      const anchorIndex = fromEnd ? visibleStopIndex : visibleStartIndex;
      const oldOffset = itemMetadataMap[anchorIndex].offset;
      const fixed = this.fixOverlaps(
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
        const offsetChange = newOffset - oldOffset;
        this.setState(prevState => ({
          scrollDirection: scrollDirection,
          // just to make sure we update even if newOffset=oldOffset since gaps might have been fixed
          scrollOffset: prevState.scrollOffset + offsetChange + 0.1,
          scrollUpdateWasRequested: false,
        }));
      }
    }
  }

  getEstimatedTotalSize() {
    const unmeasuredItemsCount = this.props.itemCount - this.measuredItemsCount;
    const unmeasuredSize = unmeasuredItemsCount * this._instanceProps.estimatedItemSize;
    const measuredSize = this.totalMeasuredSize;
    return measuredSize + unmeasuredSize;
  }

  setSize(index, node) {
    if (index < 0) return;
    const { direction, layout } = this.props;
    const isHorizontal = direction === "horizontal" || layout === "horizontal";
    const newSize = isHorizontal ? node.offsetWidth : node.offsetHeight;

    const itemMetadataMap = this._instanceProps.itemMetadataMap;
    if (newSize > 0 && itemMetadataMap[index].size !== newSize) {
      const currentItemData = itemMetadataMap[index];
      const oldSize = itemMetadataMap[index].size;
      itemMetadataMap[index] = {
        offset: currentItemData.offset,
        size: newSize
      };
      // update estimated total size
      if (!this.measuredItemsDict[index]) {
        this.measuredItemsDict[index] = index;
        this.measuredItemsCount += 1;
      }
      this.totalMeasuredSize = this.totalMeasuredSize - oldSize + newSize;
      this.requestUpdate();
    }
  }

  getItemSize(index) {
    const item = getItemMetadata(this.props, index, this._instanceProps);
    const savedSize = item ? item.size : 0;
    return savedSize ? savedSize : 50;
  }

  pushAboveZero(itemMetadataMap, index, endIndex) {
    // when offset becomes negative push to zero since scrollTop doesnt understand negative values
    const pushValue = 0 - itemMetadataMap[index].offset;
    if (pushValue < 0) return;
    for (let i = index; i <= endIndex; i++) {
      if (!itemMetadataMap[i]) break;
      itemMetadataMap[i].offset += pushValue;
    }
  }

  pullBackToZero(itemMetadataMap, index, endIndex) {
    // Sometimes we fixOverlaps() and first item is nolonger at 0. 
    // This creates a gap as we scroll from end to start.
    const pullValue = itemMetadataMap[index].offset;
    if (pullValue < 0) return;
    for (let i = index; i <= endIndex; i++) {
      if (!itemMetadataMap[i]) break;
      itemMetadataMap[i].offset -= pullValue;
    }
  }

  fixOverlaps(
    itemCount,
    itemMetadataMap,
    fromIndex,
    endIndex,
    fromEnd
  ) {
    let fixed = false;

    // skip fixing if already doing it
    if (this.fixingInProgress) return fixed;
    else this.fixingInProgress = true;

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
        this.pushAboveZero(itemMetadataMap, indexBelowZero, endIndex + 1);
      }
      if (fromIndex === 0 && itemMetadataMap[fromIndex].offset > 0) {
        // fix first item push above zero
        this.pullBackToZero(itemMetadataMap, fromIndex, endIndex + 1);
      }
    }
    this.fixingInProgress = false;
    return fixed;
  }

  // override so we can attach our custom getItemSize function
  _getItemStyle = (index) => {
    const { direction, itemSize, layout } = this.props;

    const itemStyleCache = this._getItemStyleCache(
      shouldResetStyleCacheOnItemSizeChange && itemSize,
      shouldResetStyleCacheOnItemSizeChange && layout,
      shouldResetStyleCacheOnItemSizeChange && direction
    );

    let style;
    if (itemStyleCache.hasOwnProperty(index)) {
      style = itemStyleCache[index];
    } else {
      const offset = getItemOffset(this.props, index, this._instanceProps);
      const size = this.getItemSize(this.props, index, this._instanceProps);

      // TODO Deprecate direction "horizontal"
      const isHorizontal =
        direction === 'horizontal' || layout === 'horizontal';

      const isRtl = direction === 'rtl';
      const offsetHorizontal = isHorizontal ? offset : 0;
      itemStyleCache[index] = style = {
        position: 'absolute',
        left: isRtl ? undefined : offsetHorizontal,
        right: isRtl ? offsetHorizontal : undefined,
        top: !isHorizontal ? offset : 0,
        height: !isHorizontal ? size : '100%',
        width: isHorizontal ? size : '100%',
      };
    }

    return style;
  };

  render() {
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
    const { isScrolling } = this.state;

    // TODO Deprecate direction "horizontal"
    const isHorizontal = direction === "horizontal" || layout === "horizontal";

    const onScroll = isHorizontal
      ? this._onScrollHorizontal
      : this._onScrollVertical;

    const [startIndex, stopIndex] = this._getRangeToRender();
    const items = [];
    if (itemCount > 0) {
      const boundSetSize = this.setSize.bind(this);
      for (let index = startIndex; index <= stopIndex; index++) {
        items.push(
          createElement(IndexedListItem, {
            data: itemData,
            key: itemKey(index, itemData),
            index,
            isScrolling: useIsScrolling ? isScrolling : undefined,
            style: this._getItemStyle(index),
            onSetSize: boundSetSize,
            childCreationCallback: children,
          })
        );
      }
    }

    // Read this value AFTER items have been created,
    // So their actual sizes (if variable) are taken into consideration.
    const estimatedTotalSize = this.getEstimatedTotalSize();

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
}