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

const getStopIndexForStartIndex = (
  props,
  startIndex,
  scrollOffset,
  instanceProps
) => {
  const { direction, height, itemCount, layout, width } = props;

  // TODO Deprecate direction "horizontal"
  const isHorizontal = direction === 'horizontal' || layout === 'horizontal';
  const size = (((isHorizontal ? width : height)));
  const itemMetadata = getItemMetadata(props, startIndex, instanceProps);
  const maxOffset = scrollOffset + size;

  let offset = itemMetadata.offset + itemMetadata.size;
  let stopIndex = startIndex;
  while (stopIndex < itemCount - 1 && offset < maxOffset) {
    stopIndex++;
    offset += getItemMetadata(props, stopIndex, instanceProps).size;
  }
  return stopIndex;
}

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
    return createElement('span', { style: this.props.style },
      this.props.childCreationCallback(this.props.index, this.childRef));
  }
}

export default class DynamicSizeList extends VariableSizeList {
  // props: componentRef, scrollFromEnd, [other VariableSizeList props]
  // will override ref and itemSize props.

  constructor(props) {
    super(props);
    this.firstScrollDone = false;
    this.fixingInProgress = false;
    //to prevent too many updates at same time, a timer will reset it
    this.updatingState = false;
    this.measuredItemsCount = 0;
    this.totalMeasuredSize = 0;
    this.lastRangeRendered = null;
    //increment it with setState to request an update. Especially usefull after children change sizes.
    this.state.stateCounter = 0;

  }

  requestUpdate() {
    const { isScrolling } = this.state;
    if (!isScrolling) {
      this.setState(prevState => ({ stateCounter: prevState.stateCounter + 1 }));
    }
  }

  _createFirstRangeToRender() {
    const { itemCount, overscanCount, height, width, direction, layout } = this.props;
    const { scrollOffset } = this.state;
    const isHorizontal = direction === "horizontal" || layout === "horizontal";
    let estimatedIndex = Math.floor(scrollOffset * itemCount / this.getEstimatedTotalSize());
    estimatedIndex = estimatedIndex < 0 ? 0 : estimatedIndex;
    if (!this.lastRangeRendered) {
      // create a new range at the begining
      const startIndex = estimatedIndex;
      const windowSize = isHorizontal ? width : height;
      const startOffset = getItemOffset(this.props, startIndex, this._instanceProps);
      const maxOffset = startOffset + windowSize;
      let offset = startOffset;
      let stopIndex = startIndex;
      while (stopIndex < itemCount && offset < maxOffset) {
        stopIndex++;
        offset += this.getItemSize(stopIndex);
      }

      const overscanStart = startIndex - overscanCount > 0 ? startIndex - overscanCount : 0;
      const overscanStop = stopIndex + overscanCount < itemCount ? stopIndex + overscanCount : itemCount - 1;
      this.lastRangeRendered = [overscanStart, overscanStop, startIndex, stopIndex];
    }
    return this.lastRangeRendered;
  }

  _getRangeToRender() {
    const { itemCount, overscanCount } = this.props;
    const { isScrolling, scrollDirection, scrollOffset } = this.state;
    let estimatedIndex = Math.floor(scrollOffset * (itemCount - 1) / this.getEstimatedTotalSize());
    estimatedIndex = estimatedIndex < 0 ? 0 : estimatedIndex;
    if (!this.lastRangeRendered) {
      // create a new range at the begining
      this._createFirstRangeToRender();
    }
    const [overscanStartIndex, overScanStopIndex] = this.lastRangeRendered;

    let nearestIndexInOverscan = overscanStartIndex;
    const firstOffset = getItemOffset(this.props, overscanStartIndex, this._instanceProps);
    let leastDistance = Math.abs(firstOffset - scrollOffset);
    for (let i = overscanStartIndex + 1; i <= overScanStopIndex; i++) {
      const nextItemOffset = getItemOffset(this.props, i, this._instanceProps);
      const difference = Math.abs(nextItemOffset - scrollOffset);
      if (difference < leastDistance) {
        nearestIndexInOverscan = i;
        leastDistance = difference;
      }
    }
    let useEstimate = scrollDirection === 'forward' ? estimatedIndex < nearestIndexInOverscan:
      estimatedIndex > nearestIndexInOverscan;
    let startIndex = useEstimate ? estimatedIndex : nearestIndexInOverscan;
    if (scrollDirection === 'backward') {
      useEstimate = estimatedIndex < nearestIndexInOverscan;
      startIndex = useEstimate ? estimatedIndex : nearestIndexInOverscan;
    }
    const stopIndex = getStopIndexForStartIndex(this.props, startIndex, scrollOffset, this._instanceProps);
    // Overscan by one item in each direction so that tab/focus works.
    // If there isn't at least one extra item, tab loops back around.
    const overscanStart = startIndex - overscanCount > 0 ? startIndex - overscanCount : 0;
    const overscanStop = stopIndex + overscanCount < itemCount ? stopIndex + overscanCount : itemCount - 1;

    this.lastRangeRendered = [
      overscanStart,
      overscanStop,
      startIndex,
      stopIndex,
    ];
    return this.lastRangeRendered;
  }

  componentDidMount() {
    super.componentDidMount();
    // give parent the list ref
    if (this.props.componentRef) this.props.componentRef.current = this;
  }

  componentDidUpdate() {
    super.componentDidUpdate();

    const itemMetadataMap = this._instanceProps.itemMetadataMap;
    const { scrollDirection, scrollOffset, isScrolling } = this.state;
    const { itemCount, scrollFromEnd, width, height, direction, layout } = this.props;
    const isHorizontal = direction === "horizontal" || layout === "horizontal";
    const windowSize = isHorizontal ? width : height;
    const [startIndex, stopIndex, visibleStartIndex, visibleStopIndex] = this._getRangeToRender();
    const visibleStartOffset = getItemOffset(this.props, visibleStartIndex, this._instanceProps);
    const visibleStopOffset = getItemOffset(this.props, visibleStopIndex, this._instanceProps);
    // scroll to end on first items population if props say we should start from end
    if (
      !this.firstScrollDone &&
      itemCount > 0 &&
      scrollFromEnd
    ) {
      if (scrollFromEnd) {
        const lastItem = getItemMetadata(this.props, itemCount - 1, this._instanceProps);
        const lastItemEndOffset = this.getEstimatedTotalSize() - lastItem.size;
        if (visibleStopOffset < lastItemEndOffset) {
          //Not near enough yet
          if (!isScrolling) {
            this.scrollTo(lastItemEndOffset + lastItem.size);
          }
        } else {
          if (this._outerRef) this._outerRef.scrollTop = visibleStopOffset;
          this.firstScrollDone = true;
        }
      } else {
        this.firstScrollDone = true;
      }
    }

    // fix overlaps after update when nolonger scrolling
    if (itemMetadataMap[startIndex] && !isScrolling && !this.updating) {
      const fromEnd = scrollDirection === "backward";
      // from from visible to overscan depending on direction of scroll
      const fixStartIndex = fromEnd ? startIndex : visibleStartIndex;
      const fixStopIndex = fromEnd ? visibleStopIndex : stopIndex;
      // fix when items are left behind and nolonger onscreen
      const fixStartOffset = getItemOffset(this.props, fixStartIndex, this._instanceProps);
      const fixStopOffset = getItemOffset(this.props, fixStopIndex, this._instanceProps);
      if (fromEnd && fixStopIndex > scrollOffset) {
        itemMetadataMap[fixStopIndex].offset = scrollOffset + windowSize - itemMetadataMap[fixStopIndex].size;
      } else if (!fromEnd && fixStartOffset < scrollOffset) {
        itemMetadataMap[fixStartIndex].offset = scrollOffset;
      }
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
          scrollOffset: prevState.scrollOffset + offsetChange,
          scrollUpdateWasRequested: false,
        }))
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
      if (itemMetadataMap[index] && !itemMetadataMap[index].measured) {
        itemMetadataMap[index].measured = true;
        this.measuredItemsCount += 1;
      }
      this.totalMeasuredSize = this.totalMeasuredSize - oldSize + newSize;
      // update estimated item size to average of measured elements
      const newItemSizeEstimate = Math.ceil(this.totalMeasuredSize / this.measuredItemsCount);
      if (newItemSizeEstimate > 1) {
        this._instanceProps.estimatedItemSize = newItemSizeEstimate;
      }
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